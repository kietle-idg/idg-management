const { google } = require('googleapis');

const CALENDAR_ID = 'deal@idgcapitalvietnam.com';

function getGoogleAuth() {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT environment variable not set');
  }
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);

  // Use domain-wide delegation to impersonate the calendar user
  const auth = new google.auth.JWT(
    credentials.client_email,
    null,
    credentials.private_key,
    ['https://www.googleapis.com/auth/calendar.readonly'],
    CALENDAR_ID // impersonate this user
  );
  return auth;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const auth = getGoogleAuth();
    const calendar = google.calendar({ version: 'v3', auth });

    const now = new Date();
    const maxDate = new Date();
    maxDate.setDate(maxDate.getDate() + 90); // Next 90 days

    const response = await calendar.events.list({
      calendarId: CALENDAR_ID,
      timeMin: now.toISOString(),
      timeMax: maxDate.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 20
    });

    const events = (response.data.items || []).map(event => {
      const start = event.start.dateTime || event.start.date;
      const isAllDay = !event.start.dateTime;
      const startDate = new Date(start);

      return {
        title: event.summary || '(No title)',
        date: isAllDay ? event.start.date : startDate.toISOString().split('T')[0],
        time: isAllDay ? 'All Day' : startDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Ho_Chi_Minh' }),
        location: event.location || '',
        type: 'Calendar',
        description: event.description || '',
        attendees: (event.attendees || []).map(a => a.email)
      };
    });

    return res.status(200).json({
      success: true,
      calendarId: CALENDAR_ID,
      eventsCount: events.length,
      events,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Calendar API error:', error);

    // If domain-wide delegation fails, try direct calendar access (shared calendar)
    if (error.message && error.message.includes('delegation')) {
      try {
        const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
        const auth = new google.auth.GoogleAuth({
          credentials,
          scopes: ['https://www.googleapis.com/auth/calendar.readonly']
        });
        const calendar = google.calendar({ version: 'v3', auth });

        const now = new Date();
        const maxDate = new Date();
        maxDate.setDate(maxDate.getDate() + 90);

        const response = await calendar.events.list({
          calendarId: CALENDAR_ID,
          timeMin: now.toISOString(),
          timeMax: maxDate.toISOString(),
          singleEvents: true,
          orderBy: 'startTime',
          maxResults: 20
        });

        const events = (response.data.items || []).map(event => {
          const start = event.start.dateTime || event.start.date;
          const isAllDay = !event.start.dateTime;
          const startDate = new Date(start);

          return {
            title: event.summary || '(No title)',
            date: isAllDay ? event.start.date : startDate.toISOString().split('T')[0],
            time: isAllDay ? 'All Day' : startDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Ho_Chi_Minh' }),
            location: event.location || '',
            type: 'Calendar'
          };
        });

        return res.status(200).json({
          success: true,
          calendarId: CALENDAR_ID,
          method: 'shared_calendar',
          eventsCount: events.length,
          events,
          timestamp: new Date().toISOString()
        });
      } catch (fallbackError) {
        console.error('Fallback calendar error:', fallbackError);
        return res.status(500).json({
          success: false,
          error: fallbackError.message,
          hint: 'Make sure the calendar is shared with the service account email, or enable domain-wide delegation in Google Workspace admin.'
        });
      }
    }

    return res.status(500).json({
      success: false,
      error: error.message,
      hint: 'Enable domain-wide delegation in Google Workspace Admin Console, or share the calendar with the service account email.'
    });
  }
};
