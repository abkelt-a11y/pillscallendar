const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');

const app = express();
app.use(cors());
app.use(express.json());

// Initialize Firebase Admin with service account from env
let serviceAccount;
try {
  const raw = process.env.FCM_SERVER_KEY;
  // Handle both single-line and multiline JSON
  serviceAccount = JSON.parse(raw.trim());
} catch(e) {
  console.error('Failed to parse FCM_SERVER_KEY:', e.message);
  console.error('Value starts with:', process.env.FCM_SERVER_KEY?.substring(0, 50));
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

// Store scheduled jobs in memory
const scheduledJobs = {};

// ── SCHEDULE NOTIFICATIONS ─────────────────────────────────────────────
app.post('/schedule', async (req, res) => {
  const { token, doses } = req.body;
  if (!token || !doses) return res.status(400).json({ error: 'Missing token or doses' });

  // Clear existing jobs for this token
  if (scheduledJobs[token]) {
    scheduledJobs[token].forEach(t => clearTimeout(t));
  }
  scheduledJobs[token] = [];

  const now = Date.now();
  let scheduled = 0;

  doses.forEach(dose => {
    const delay = dose.time - now;
    if (delay < 0) return;

    // Main notification
    const t1 = setTimeout(async () => {
      try {
        await admin.messaging().send({
          token,
          notification: {
            title: '💊 MediTrack — Ώρα για χάπι!',
            body: `${dose.label} — ${dose.dose} χάπι`
          },
          android: {
            priority: 'high',
            notification: {
              sound: 'default',
              channelId: 'pill_reminders',
              vibrateTimingsMillis: [200, 100, 200, 100, 200],
              priority: 'max'
            }
          },
          data: { doseIndex: String(dose.index), type: 'dose' }
        });
        console.log(`[FCM] Sent dose ${dose.index + 1} notification`);
      } catch(e) {
        console.error('[FCM] Error:', e.message);
      }
    }, delay);
    scheduledJobs[token].push(t1);
    scheduled++;

    // 10 min warning (only if delay > 15 min)
    if (delay > 900000) {
      const t2 = setTimeout(async () => {
        try {
          await admin.messaging().send({
            token,
            notification: {
              title: '⏳ MediTrack — Σε 10 λεπτά χάπι',
              body: `${dose.label} — Προετοιμάσου!`
            },
            android: {
              priority: 'high',
              notification: { sound: 'default', channelId: 'pill_reminders' }
            }
          });
        } catch(e) { console.error('[FCM] Warning error:', e.message); }
      }, delay - 600000);
      scheduledJobs[token].push(t2);
    }
  });

  console.log(`[Server] Scheduled ${scheduled} notifications for token ...${token.slice(-8)}`);
  res.json({ success: true, scheduled });
});

// ── CANCEL ─────────────────────────────────────────────────────────────
app.post('/cancel', (req, res) => {
  const { token } = req.body;
  if (scheduledJobs[token]) {
    scheduledJobs[token].forEach(t => clearTimeout(t));
    delete scheduledJobs[token];
  }
  res.json({ success: true });
});

// ── HEALTH CHECK ───────────────────────────────────────────────────────
app.get('/', (req, res) => res.json({ status: 'MediTrack server running 💊' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`[Server] Running on port ${PORT}`));
