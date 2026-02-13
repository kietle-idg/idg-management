// IDGX Capital — AI Chat Widget
// Self-contained: creates UI, loads data, handles messages
// Only visible to Admin and GP roles

(function() {
  'use strict';

  let chatOpen = false;
  let chatInitialized = false;
  let portfolioContext = null;
  let conversationHistory = [];
  let isLoading = false;

  // ── Wait for Auth to be ready, then check role ──
  function waitForAuth(cb) {
    const check = () => {
      if (typeof Auth !== 'undefined' && Auth.currentUserData) {
        cb(Auth.currentUserData);
      } else {
        setTimeout(check, 300);
      }
    };
    check();
  }

  // ── Build portfolio context string ──
  function buildContext(companies, fund) {
    let ctx = '';

    if (fund) {
      ctx += `FUND: ${fund.fundName || 'IDGX Capital Fund I'}\n`;
      ctx += `Fund Size: $${fmt(fund.fundSize)}\n`;
      ctx += `AUM: $${fmt(fund.aum)}\n`;
      ctx += `Vintage: ${fund.vintage || 'N/A'}\n\n`;
    }

    ctx += `PORTFOLIO (${companies.length} companies):\n\n`;

    for (const c of companies) {
      ctx += `--- ${c.name || c.displayName} ---\n`;
      if (c.status) ctx += `Status: ${c.status}\n`;
      if (c.sector) ctx += `Sector: ${c.sector}\n`;
      if (c.stage) ctx += `Stage: ${c.stage}\n`;
      if (c.location) ctx += `Location: ${c.location}\n`;
      if (c.founder) ctx += `Founders: ${c.founder}\n`;
      const droomUrl = c.dataroomUrl || (c.driveFolderId ? `https://drive.google.com/drive/folders/${c.driveFolderId}` : null);
      if (droomUrl) ctx += `Dataroom Link: ${droomUrl}\n`;
      if (c.investmentAmount) ctx += `Investment Amount: $${fmt(c.investmentAmount)}\n`;
      if (c.entryValuation) ctx += `Entry Valuation: $${fmt(c.entryValuation)}\n`;
      if (c.currentValuation) ctx += `Current Valuation: $${fmt(c.currentValuation)}\n`;
      if (c.ownership) ctx += `Ownership: ${c.ownership}%\n`;

      // MOIC
      const moic = calcMoic(c);
      if (moic > 0) ctx += `MOIC: ${moic.toFixed(2)}x\n`;

      // Exit info
      if (c.status === 'Exited') {
        if (c.exitProceeds) ctx += `Exit Proceeds: $${fmt(c.exitProceeds)}\n`;
        if (c.exitDate) ctx += `Exit Date: ${c.exitDate}\n`;
      }
      if (c.status === 'Partially Exited') {
        if (c.amountRealized) ctx += `Amount Realized: $${fmt(c.amountRealized)}\n`;
        if (c.remainingCostBasis) ctx += `Remaining Cost Basis: $${fmt(c.remainingCostBasis)}\n`;
      }

      if (c.description) ctx += `Description: ${c.description}\n`;
      // AI-extracted data (stored with "ai" prefix)
      const updates = c.aiUpdates || c.latestUpdates || [];
      if (updates.length) {
        ctx += `Latest Updates:\n`;
        updates.forEach(u => { ctx += `  - ${u}\n`; });
      }
      const highlights = c.aiHighlights || c.highlights || [];
      if (highlights.length) {
        ctx += `Highlights:\n`;
        highlights.forEach(h => { ctx += `  - ${h}\n`; });
      }
      const metrics = c.aiKeyMetrics || c.keyMetrics;
      if (metrics && Object.keys(metrics).length) {
        ctx += `Key Metrics: ${JSON.stringify(metrics)}\n`;
      }
      if (c.createdAt) {
        const d = c.createdAt.toDate ? c.createdAt.toDate() : new Date(c.createdAt);
        ctx += `Record Created: ${d.toLocaleDateString()}\n`;
      }
      ctx += '\n';
    }

    return ctx;
  }

  function fmt(n) {
    if (!n) return '0';
    if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(0) + 'K';
    return n.toLocaleString();
  }

  function calcMoic(c) {
    if (c.status === 'Exited') {
      return (c.exitProceeds > 0 && c.investmentAmount > 0) ? c.exitProceeds / c.investmentAmount : 0;
    }
    if (c.status === 'Partially Exited') {
      const baseMoic = (c.currentValuation > 0 && c.entryValuation > 0) ? c.currentValuation / c.entryValuation : (c.moic || 0);
      const unrealized = (c.remainingCostBasis || 0) * baseMoic;
      const total = (c.amountRealized || 0) + unrealized;
      return c.investmentAmount > 0 ? total / c.investmentAmount : 0;
    }
    if (c.currentValuation > 0 && c.entryValuation > 0) return c.currentValuation / c.entryValuation;
    if (c.moic && c.moic > 0) return c.moic;
    return 0;
  }

  // ── Load data from Firestore ──
  async function loadPortfolioContext() {
    try {
      const companies = await Database.getCompanies();
      const fund = await Database.getFund();
      portfolioContext = buildContext(companies || [], fund);
      return true;
    } catch (e) {
      console.error('Chat: failed to load portfolio data', e);
      return false;
    }
  }

  // ── Send message to API ──
  async function sendMessage(text) {
    conversationHistory.push({ role: 'user', content: text });

    try {
      const resp = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: conversationHistory,
          context: portfolioContext
        })
      });

      const data = await resp.json();

      if (data.success && data.answer) {
        conversationHistory.push({ role: 'assistant', content: data.answer });
        return data.answer;
      } else {
        throw new Error(data.error || 'Unknown error');
      }
    } catch (e) {
      console.error('Chat API error:', e);
      conversationHistory.pop(); // remove failed user message
      return 'Sorry, something went wrong. Please try again.';
    }
  }

  // ── Render UI ──
  function createWidget() {
    // Floating button
    const btn = document.createElement('button');
    btn.id = 'chat-fab';
    btn.setAttribute('aria-label', 'Open AI Chat');
    btn.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
    document.body.appendChild(btn);

    // Chat panel
    const panel = document.createElement('div');
    panel.id = 'chat-panel';
    panel.classList.add('chat-hidden');
    panel.innerHTML = `
      <div class="chat-header">
        <div class="chat-header-left">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
          <span>IDGX Assistant</span>
        </div>
        <button class="chat-close" aria-label="Close chat">&times;</button>
      </div>
      <div class="chat-messages" id="chat-messages">
        <div class="chat-msg chat-msg-ai">
          <div class="chat-msg-content">Hi! I can answer questions about your portfolio. Try asking about company valuations, MOICs, sectors, or latest updates.</div>
        </div>
      </div>
      <form class="chat-input-bar" id="chat-form">
        <input type="text" id="chat-input" placeholder="Ask about your portfolio..." autocomplete="off" />
        <button type="submit" id="chat-send" aria-label="Send">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
        </button>
      </form>
    `;
    document.body.appendChild(panel);

    // Event listeners
    btn.addEventListener('click', toggleChat);
    panel.querySelector('.chat-close').addEventListener('click', toggleChat);
    document.getElementById('chat-form').addEventListener('submit', handleSubmit);
  }

  function toggleChat() {
    chatOpen = !chatOpen;
    const panel = document.getElementById('chat-panel');
    const fab = document.getElementById('chat-fab');

    if (chatOpen) {
      panel.classList.remove('chat-hidden');
      panel.classList.add('chat-visible');
      fab.classList.add('chat-fab-active');
      document.getElementById('chat-input').focus();

      // Load context on first open
      if (!chatInitialized) {
        chatInitialized = true;
        loadPortfolioContext().then(ok => {
          if (!ok) {
            appendMessage('ai', 'I had trouble loading portfolio data. Some answers may be limited.');
          }
        });
      }
    } else {
      panel.classList.remove('chat-visible');
      panel.classList.add('chat-hidden');
      fab.classList.remove('chat-fab-active');
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    if (!text || isLoading) return;

    input.value = '';
    appendMessage('user', text);

    // Show typing indicator
    isLoading = true;
    const typingEl = appendMessage('ai', '<span class="chat-typing"><span></span><span></span><span></span></span>');
    document.getElementById('chat-send').disabled = true;

    const answer = await sendMessage(text);

    // Replace typing indicator with answer
    typingEl.querySelector('.chat-msg-content').innerHTML = formatAnswer(answer);
    isLoading = false;
    document.getElementById('chat-send').disabled = false;
    scrollToBottom();
  }

  function appendMessage(role, html) {
    const container = document.getElementById('chat-messages');
    const div = document.createElement('div');
    div.className = `chat-msg chat-msg-${role === 'user' ? 'user' : 'ai'}`;
    div.innerHTML = `<div class="chat-msg-content">${html}</div>`;
    container.appendChild(div);
    scrollToBottom();
    return div;
  }

  function scrollToBottom() {
    const container = document.getElementById('chat-messages');
    container.scrollTop = container.scrollHeight;
  }

  function formatAnswer(text) {
    // Basic markdown-like formatting
    return text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\n- /g, '\n• ')
      .replace(/\n/g, '<br>')
      .replace(/`(.*?)`/g, '<code>$1</code>');
  }

  // ── Initialize ──
  function init() {
    waitForAuth(function(user) {
      const role = user?.role;
      if (role !== 'Admin' && role !== 'GP') return; // Only Admin and GP
      createWidget();
    });
  }

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
