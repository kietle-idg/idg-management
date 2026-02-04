// IDGX Capital - Simple Local Version
// ====================================

// Current user state (simulated)
let currentUser = null;

// Data cache
let fundData = null;
let companiesData = [];
let usersData = [];
let eventsData = [];
let tasksData = [];

// ==================
// DATA LOADING
// ==================

async function loadJSON(filename) {
  try {
    const response = await fetch(`data/${filename}`);
    if (!response.ok) throw new Error(`Failed to load ${filename}`);
    return await response.json();
  } catch (error) {
    console.error(`Error loading ${filename}:`, error);
    return null;
  }
}

async function loadAllData() {
  const [fund, companies, users, events, tasks] = await Promise.all([
    loadJSON('fund.json'),
    loadJSON('companies.json'),
    loadJSON('users.json'),
    loadJSON('events.json'),
    loadJSON('tasks.json')
  ]);
  
  fundData = fund;
  companiesData = companies || [];
  usersData = users || [];
  eventsData = events || [];
  tasksData = tasks || [];
  
  return { fund, companies, users, events, tasks };
}

// ==================
// USER MANAGEMENT
// ==================

function setCurrentUser(userId) {
  currentUser = usersData.find(u => u.id === userId) || null;
  localStorage.setItem('currentUserId', userId);
  return currentUser;
}

function getCurrentUser() {
  if (currentUser) return currentUser;
  
  const savedId = localStorage.getItem('currentUserId');
  if (savedId && usersData.length > 0) {
    currentUser = usersData.find(u => u.id === savedId);
  }
  
  // Default to first GP
  if (!currentUser && usersData.length > 0) {
    currentUser = usersData.find(u => u.role === 'GP') || usersData[0];
    localStorage.setItem('currentUserId', currentUser.id);
  }
  
  return currentUser;
}

function getUserRole() {
  return currentUser?.role || 'GP';
}

function hasRole(role) {
  return currentUser?.role === role;
}

function hasAnyRole(roles) {
  return roles.includes(currentUser?.role);
}

// ==================
// FORMATTING
// ==================

function formatCurrency(amount) {
  if (!amount) return '$0';
  if (amount >= 1000000000) return '$' + (amount / 1000000000).toFixed(1) + 'B';
  if (amount >= 1000000) return '$' + (amount / 1000000).toFixed(1) + 'M';
  if (amount >= 1000) return '$' + (amount / 1000).toFixed(0) + 'K';
  return '$' + amount.toLocaleString();
}

function formatPercent(value) {
  return (value || 0).toFixed(1) + '%';
}

function formatDate(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', { 
    month: 'short', 
    day: 'numeric', 
    year: 'numeric' 
  });
}

function formatDateShort(dateString) {
  if (!dateString) return { day: '--', month: '---' };
  const date = new Date(dateString);
  return {
    day: date.getDate(),
    month: date.toLocaleDateString('en-US', { month: 'short' })
  };
}

function getDaysUntil(dateString) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateString);
  target.setHours(0, 0, 0, 0);
  return Math.ceil((target - today) / (1000 * 60 * 60 * 24));
}

function getStageBadgeClass(stage) {
  if (stage === 'Seed') return 'badge-warning';
  if (stage === 'Series A') return 'badge-success';
  if (stage === 'Series B') return 'badge-primary';
  if (stage === 'Exited') return 'badge-default';
  return 'badge-default';
}

// ==================
// NAVBAR
// ==================

function renderNavbar() {
  const user = getCurrentUser();
  
  // Update user display
  const nameEl = document.getElementById('user-name');
  const avatarEl = document.getElementById('user-avatar');
  const roleEl = document.getElementById('user-role-text');
  
  if (nameEl) nameEl.textContent = user?.name || 'Select User';
  if (avatarEl) avatarEl.textContent = user?.name?.split(' ').map(n => n[0]).join('') || '?';
  if (roleEl) roleEl.textContent = user?.role || '';
  
  // Update nav visibility based on role
  const adminNav = document.getElementById('nav-admin');
  const portfolioNav = document.getElementById('nav-portfolio');
  
  if (adminNav) {
    adminNav.classList.toggle('hidden', user?.role !== 'Admin');
  }
  if (portfolioNav) {
    portfolioNav.classList.toggle('hidden', user?.role === 'LP');
  }
  
  // Populate user dropdown
  const userList = document.getElementById('user-list');
  if (userList) {
    const groups = {
      'GP': usersData.filter(u => u.role === 'GP'),
      'LP': usersData.filter(u => u.role === 'LP'),
      'Team': usersData.filter(u => u.role === 'Team')
    };
    
    let html = '';
    for (const [role, users] of Object.entries(groups)) {
      if (users.length > 0) {
        html += `<div class="dropdown-label">${role === 'GP' ? 'General Partners' : role === 'LP' ? 'Limited Partners' : 'Team'}</div>`;
        users.forEach(u => {
          html += `<button class="dropdown-item ${u.id === user?.id ? 'active' : ''}" onclick="switchUser('${u.id}')">${u.name}</button>`;
        });
      }
    }
    userList.innerHTML = html;
  }
}

function switchUser(userId) {
  setCurrentUser(userId);
  window.location.reload();
}

// ==================
// EXPORT FUNCTIONS
// ==================

function exportToPDF() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  
  doc.setFontSize(20);
  doc.text('IDGX Capital - Portfolio Companies', 14, 22);
  doc.setFontSize(10);
  doc.text('Generated: ' + new Date().toLocaleDateString(), 14, 30);

  const tableData = companiesData.map(c => [
    c.name,
    c.stage,
    formatCurrency(c.investmentAmount),
    formatCurrency(c.currentValuation),
    (c.ownership || 0).toFixed(1) + '%',
    c.status
  ]);

  doc.autoTable({
    head: [['Company', 'Stage', 'Invested', 'Valuation', 'Ownership', 'Status']],
    body: tableData,
    startY: 40,
    styles: { fontSize: 9 },
    headStyles: { fillColor: [124, 58, 237] }
  });

  doc.save('idg-portfolio.pdf');
}

function exportToExcel() {
  const data = companiesData.map(c => ({
    'Company': c.name,
    'Sector': c.sector,
    'Stage': c.stage,
    'Investment Date': c.investmentDate,
    'Invested': c.investmentAmount,
    'Valuation': c.currentValuation,
    'Ownership %': c.ownership,
    'Founder': c.founder,
    'Status': c.status,
    'Location': c.location
  }));

  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Portfolio');
  XLSX.writeFile(wb, 'idg-portfolio.xlsx');
}

// Export globally
window.loadAllData = loadAllData;
window.getCurrentUser = getCurrentUser;
window.setCurrentUser = setCurrentUser;
window.getUserRole = getUserRole;
window.hasRole = hasRole;
window.hasAnyRole = hasAnyRole;
window.renderNavbar = renderNavbar;
window.switchUser = switchUser;
window.formatCurrency = formatCurrency;
window.formatPercent = formatPercent;
window.formatDate = formatDate;
window.formatDateShort = formatDateShort;
window.getDaysUntil = getDaysUntil;
window.getStageBadgeClass = getStageBadgeClass;
window.exportToPDF = exportToPDF;
window.exportToExcel = exportToExcel;

window.fundData = fundData;
window.companiesData = companiesData;
window.usersData = usersData;
window.eventsData = eventsData;
window.tasksData = tasksData;
