/**
 * Propel Dialer — Demo Seed
 * Run: cd backend && npx ts-node prisma/seed.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const daysAgo = (n: number, h = 10, m = 0) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(h, m, 0, 0);
  return d;
};
const future = (n: number, h: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(h, 0, 0, 0);
  return d;
};

async function main() {
  console.log('🌱 Seeding demo data...');

  // Clear in dependency order
  await prisma.appointment.deleteMany({});
  await prisma.call.deleteMany({});
  await prisma.message.deleteMany({});
  await prisma.emailTemplate.deleteMany({});
  await prisma.contact.deleteMany({});

  // ── Contacts ────────────────────────────────────────────────────────────────
  const contactData = [
    // Expired listings
    { firstName: 'James',    lastName: 'Patterson',  phone: '+14435550101', address: '1842 Ridgewood Dr',     city: 'Baltimore',     state: 'MD', zip: '21201', source: 'expired',     status: 'hot',         leadScore: 88, email: 'jpatterson@gmail.com',   notes: 'Very motivated seller. Listed 90 days, fired previous agent.' },
    { firstName: 'Maria',    lastName: 'Gonzalez',   phone: '+14435550102', address: '3310 Elm Street',       city: 'Towson',        state: 'MD', zip: '21204', source: 'expired',     status: 'callback',    leadScore: 74, email: 'mgonzalez@yahoo.com',    notes: 'Needs to discuss with husband. Call back Saturday.' },
    { firstName: 'Thomas',   lastName: 'Whitfield',  phone: '+14435550110', address: '5820 Harford Rd',       city: 'Baltimore',     state: 'MD', zip: '21214', source: 'expired',     status: 'contacted',   leadScore: 61, notes: 'Interested but wavering. Follow up with email.' },
    { firstName: 'Beverly',  lastName: 'Simmons',    phone: '+14435550111', address: '712 Dulaney Valley Rd', city: 'Towson',        state: 'MD', zip: '21286', source: 'expired',     status: 'new',         leadScore: 45 },
    { firstName: 'Richard',  lastName: 'Thornton',   phone: '+14435550112', address: '3041 Bel Air Rd',       city: 'Baltimore',     state: 'MD', zip: '21213', source: 'expired',     status: 'new',         leadScore: 39 },
    { firstName: 'Deborah',  lastName: 'Kane',       phone: '+14435550121', address: '901 Old Court Rd',      city: 'Pikesville',    state: 'MD', zip: '21208', source: 'expired',     status: 'new',         leadScore: 36 },
    // FSBO
    { firstName: 'Robert',   lastName: 'Chen',       phone: '+14435550103', address: '504 Maple Ave',         city: 'Catonsville',   state: 'MD', zip: '21228', source: 'fsbo',        status: 'contacted',   leadScore: 55, email: 'rchen@outlook.com' },
    { firstName: 'Sandra',   lastName: 'Williams',   phone: '+14435550104', address: '721 Oak Lane',          city: 'Ellicott City', state: 'MD', zip: '21042', source: 'fsbo',        status: 'new',         leadScore: 42 },
    { firstName: 'Kevin',    lastName: 'OBrien',     phone: '+14435550113', address: '1590 Frederick Rd',     city: 'Catonsville',   state: 'MD', zip: '21228', source: 'fsbo',        status: 'contacted',   leadScore: 52 },
    { firstName: 'Patricia', lastName: 'Lawson',     phone: '+14435550114', address: '88 Ingleside Ave',      city: 'Baltimore',     state: 'MD', zip: '21228', source: 'fsbo',        status: 'new',         leadScore: 38 },
    { firstName: 'Aaron',    lastName: 'Nix',        phone: '+14435550122', address: '2290 Gwynn Oak Ave',    city: 'Baltimore',     state: 'MD', zip: '21207', source: 'fsbo',        status: 'new',         leadScore: 31 },
    // Circle prospecting
    { firstName: 'David',    lastName: 'Thompson',   phone: '+14435550105', address: '29 Harbor View Rd',     city: 'Annapolis',     state: 'MD', zip: '21401', source: 'circle',      status: 'new',         leadScore: 31 },
    { firstName: 'Linda',    lastName: 'Martinez',   phone: '+14435550106', address: '118 Sunrise Blvd',      city: 'Glen Burnie',   state: 'MD', zip: '21061', source: 'circle',      status: 'new',         leadScore: 28 },
    { firstName: 'Gregory',  lastName: 'Holt',       phone: '+14435550115', address: '2204 Northern Pkwy',    city: 'Baltimore',     state: 'MD', zip: '21210', source: 'circle',      status: 'new',         leadScore: 22 },
    { firstName: 'Angela',   lastName: 'Foster',     phone: '+14435550116', address: '441 Stevenson Rd',      city: 'Baltimore',     state: 'MD', zip: '21212', source: 'circle',      status: 'callback',    leadScore: 34 },
    { firstName: 'Harriet',  lastName: 'Osei',       phone: '+14435550123', address: '560 Loch Raven Blvd',   city: 'Baltimore',     state: 'MD', zip: '21239', source: 'circle',      status: 'new',         leadScore: 17 },
    // Past clients
    { firstName: 'Michael',  lastName: 'Johnson',    phone: '+14435550107', address: '660 Pinecrest Dr',      city: 'Columbia',      state: 'MD', zip: '21044', source: 'past-client', status: 'hot',         leadScore: 91, email: 'mjohnson@gmail.com',    notes: 'Pre-approved $650k. Wants 4BR in Columbia. Ready now.' },
    { firstName: 'Patricia', lastName: 'Davis',      phone: '+14435550108', address: '3024 Joes Rd',          city: 'Albany',        state: 'NY', zip: '12207', source: 'past-client', status: 'contacted',   leadScore: 67, email: 'pdavis@icloud.com' },
    { firstName: 'Jennifer', lastName: 'Walsh',      phone: '+14435550117', address: '1140 River Rd',         city: 'Annapolis',     state: 'MD', zip: '21409', source: 'past-client', status: 'callback',    leadScore: 72, email: 'jwalsh@gmail.com',      notes: 'Thinking about selling in spring. Very warm.' },
    { firstName: 'Charles',  lastName: 'Monroe',     phone: '+14435550118', address: '520 Hillen Rd',         city: 'Towson',        state: 'MD', zip: '21286', source: 'past-client', status: 'hot',         leadScore: 77 },
    { firstName: 'Tamara',   lastName: 'Ellison',    phone: '+14435550124', address: '7801 York Rd',          city: 'Towson',        state: 'MD', zip: '21204', source: 'past-client', status: 'callback',    leadScore: 48 },
    // Manual
    { firstName: 'Nancy',    lastName: 'Carter',     phone: '+14435550109', address: '850 Eutaw Place',       city: 'Baltimore',     state: 'MD', zip: '21201', source: 'manual',      status: 'hot',         leadScore: 71, notes: 'Downsizing — son moving back in.' },
    { firstName: 'Daniel',   lastName: 'Brooks',     phone: '+14435550119', address: '3312 Belvieu Ave',      city: 'Baltimore',     state: 'MD', zip: '21215', source: 'manual',      status: 'hot',         leadScore: 69 },
    { firstName: 'Susan',    lastName: 'Grant',      phone: '+14435550120', address: '744 Edmondson Ave',     city: 'Baltimore',     state: 'MD', zip: '21228', source: 'manual',      status: 'new',         leadScore: 29 },
    { firstName: 'Marcus',   lastName: 'Webb',       phone: '+14435550125', address: '1221 Dundalk Ave',      city: 'Baltimore',     state: 'MD', zip: '21222', source: 'manual',      status: 'appointment', leadScore: 79, notes: 'Appointment set. Urgent 45-day close needed.' },
  ];

  await prisma.contact.createMany({ data: contactData });
  console.log('✅ Contacts created:', contactData.length);

  const all = await prisma.contact.findMany({ orderBy: { createdAt: 'asc' } });
  const get = (fn: string, ln: string) => all.find(c => c.firstName === fn && c.lastName === ln)!;

  const james    = get('James',    'Patterson');
  const maria    = get('Maria',    'Gonzalez');
  const michael  = get('Michael',  'Johnson');
  const jennifer = get('Jennifer', 'Walsh');
  const robert   = get('Robert',   'Chen');
  const thomas   = get('Thomas',   'Whitfield');
  const patricia = get('Patricia', 'Davis');
  const marcus   = get('Marcus',   'Webb');
  const beverly  = get('Beverly',  'Simmons');
  const charles  = get('Charles',  'Monroe');
  const tamara   = get('Tamara',   'Ellison');
  const david    = get('David',    'Thompson');
  const linda    = get('Linda',    'Martinez');
  const kevin    = get('Kevin',    'OBrien');
  const angela   = get('Angela',   'Foster');
  const richard  = get('Richard',  'Thornton');
  const nancy    = get('Nancy',    'Carter');
  const daniel   = get('Daniel',   'Brooks');
  const gregory  = get('Gregory',  'Holt');

  // ── Calls — 14 days of history for rich analytics charts ───────────────────
  const callData = [
    // Day 0 (today)
    { contactId: michael.id,  duration: 312, disposition: 'hot-lead',           notes: 'Ready to buy NOW. Pre-approved $650k. Tour this weekend.',         calledAt: daysAgo(0,  9, 15) },
    { contactId: james.id,    duration: 187, disposition: 'hot-lead',           notes: 'Very motivated. Wants to list ASAP. Sending CMA.',                 calledAt: daysAgo(0, 10, 30) },
    { contactId: beverly.id,  duration: 45,  disposition: 'not-home',           notes: 'No answer, left voicemail.',                                        calledAt: daysAgo(0, 11,  0) },
    { contactId: nancy.id,    duration: 0,   disposition: 'not-home',           notes: 'No answer.',                                                        calledAt: daysAgo(0, 11, 20) },
    { contactId: gregory.id,  duration: 78,  disposition: 'not-interested',     notes: 'Not ready to move yet.',                                            calledAt: daysAgo(0, 14,  0) },
    // Day 1
    { contactId: james.id,    duration: 43,  disposition: 'not-home',           notes: 'No answer, left voicemail.',                                        calledAt: daysAgo(1,  9,  0) },
    { contactId: thomas.id,   duration: 155, disposition: 'left-voicemail',     notes: 'Left detailed voicemail about marketing plan.',                     calledAt: daysAgo(1,  9, 45) },
    { contactId: patricia.id, duration: 245, disposition: 'hot-lead',           notes: 'Motivated seller — divorce situation. Needs quick close.',          calledAt: daysAgo(1, 10, 30) },
    { contactId: tamara.id,   duration: 112, disposition: 'callback-scheduled', notes: 'Will call back after vacation. Very warm lead.',                    calledAt: daysAgo(1, 11, 15) },
    { contactId: angela.id,   duration: 0,   disposition: 'not-home',           notes: 'No answer.',                                                        calledAt: daysAgo(1, 14,  0) },
    { contactId: daniel.id,   duration: 88,  disposition: 'callback-scheduled', notes: 'Thinking about selling in 3 months.',                               calledAt: daysAgo(1, 14, 45) },
    { contactId: richard.id,  duration: 0,   disposition: 'not-home',           notes: '',                                                                  calledAt: daysAgo(1, 15, 30) },
    // Day 2
    { contactId: maria.id,    duration: 124, disposition: 'callback-scheduled', notes: 'Interested but needs to talk to husband. Call back Saturday.',      calledAt: daysAgo(2,  9, 30) },
    { contactId: jennifer.id, duration: 201, disposition: 'callback-scheduled', notes: 'Thinking about selling in spring.',                                 calledAt: daysAgo(2, 10, 15) },
    { contactId: marcus.id,   duration: 320, disposition: 'hot-lead',           notes: 'Set appointment for next week. Urgent timeline 45 days.',           calledAt: daysAgo(2, 11,  0) },
    { contactId: charles.id,  duration: 145, disposition: 'left-voicemail',     notes: 'Left voicemail about market update.',                               calledAt: daysAgo(2, 13, 30) },
    { contactId: david.id,    duration: 0,   disposition: 'not-home',           notes: 'No answer.',                                                        calledAt: daysAgo(2, 14,  0) },
    { contactId: linda.id,    duration: 62,  disposition: 'not-interested',     notes: 'Happy in current home for now.',                                    calledAt: daysAgo(2, 14, 45) },
    // Day 3
    { contactId: james.id,    duration: 95,  disposition: 'callback-scheduled', notes: 'Following up on voicemail. Set time to talk.',                      calledAt: daysAgo(3,  9,  0) },
    { contactId: kevin.id,    duration: 134, disposition: 'left-voicemail',     notes: 'FSBO showing signs of frustration after 6 weeks.',                  calledAt: daysAgo(3,  9, 45) },
    { contactId: thomas.id,   duration: 0,   disposition: 'not-home',           notes: '',                                                                  calledAt: daysAgo(3, 11,  0) },
    { contactId: patricia.id, duration: 88,  disposition: 'left-voicemail',     notes: 'Left VM with pricing info.',                                        calledAt: daysAgo(3, 14,  0) },
    { contactId: tamara.id,   duration: 0,   disposition: 'not-home',           notes: '',                                                                  calledAt: daysAgo(3, 15,  0) },
    // Day 4
    { contactId: james.id,    duration: 0,   disposition: 'not-home',           notes: '',                                                                  calledAt: daysAgo(4,  9, 30) },
    { contactId: maria.id,    duration: 77,  disposition: 'left-voicemail',     notes: 'Left VM about open house success stories.',                         calledAt: daysAgo(4, 10, 15) },
    { contactId: beverly.id,  duration: 134, disposition: 'callback-scheduled', notes: 'Open to hearing more. Call back next week.',                        calledAt: daysAgo(4, 11,  0) },
    { contactId: richard.id,  duration: 143, disposition: 'left-voicemail',     notes: 'Left VM about neighborhood comparable sales.',                      calledAt: daysAgo(4, 14,  0) },
    // Day 5
    { contactId: robert.id,   duration: 67,  disposition: 'not-interested',     notes: 'Listed with another agent.',                                        calledAt: daysAgo(5,  9, 30) },
    { contactId: michael.id,  duration: 98,  disposition: 'not-home',           notes: 'Left VM about new listings.',                                       calledAt: daysAgo(5, 10, 15) },
    { contactId: angela.id,   duration: 110, disposition: 'callback-scheduled', notes: 'Open to selling if price is right.',                                calledAt: daysAgo(5, 11,  0) },
    { contactId: nancy.id,    duration: 199, disposition: 'hot-lead',           notes: 'Downsizing — son moving back in. Very motivated.',                  calledAt: daysAgo(5, 14,  0) },
    // Day 6
    { contactId: thomas.id,   duration: 0,   disposition: 'not-home',           notes: '',                                                                  calledAt: daysAgo(6,  9,  0) },
    { contactId: daniel.id,   duration: 175, disposition: 'hot-lead',           notes: 'Getting divorced. Needs to sell fast.',                             calledAt: daysAgo(6, 10,  0) },
    { contactId: charles.id,  duration: 190, disposition: 'hot-lead',           notes: 'Wife got job transfer. Need to sell in 60 days.',                   calledAt: daysAgo(6, 10, 30) },
    { contactId: linda.id,    duration: 88,  disposition: 'callback-scheduled', notes: 'Reconsidering. Will know more next week.',                          calledAt: daysAgo(6, 14,  0) },
    { contactId: david.id,    duration: 134, disposition: 'left-voicemail',     notes: 'Left VM about investment potential.',                               calledAt: daysAgo(6, 15,  0) },
    // Day 7
    { contactId: michael.id,  duration: 0,   disposition: 'not-home',           notes: '',                                                                  calledAt: daysAgo(7,  9,  0) },
    { contactId: jennifer.id, duration: 88,  disposition: 'callback-scheduled', notes: 'More open to spring listing.',                                      calledAt: daysAgo(7, 10,  0) },
    { contactId: kevin.id,    duration: 205, disposition: 'hot-lead',           notes: 'FSBO not getting traction. Ready to hire agent.',                   calledAt: daysAgo(7, 11,  0) },
    { contactId: gregory.id,  duration: 0,   disposition: 'not-home',           notes: '',                                                                  calledAt: daysAgo(7, 14,  0) },
    // Day 8
    { contactId: beverly.id,  duration: 0,   disposition: 'not-home',           notes: '',                                                                  calledAt: daysAgo(8,  9, 30) },
    { contactId: tamara.id,   duration: 155, disposition: 'callback-scheduled', notes: 'Back from vacation. Will call back Thursday.',                      calledAt: daysAgo(8, 10, 15) },
    { contactId: patricia.id, duration: 133, disposition: 'callback-scheduled', notes: 'Open to listing. Schedule walkthrough next week.',                  calledAt: daysAgo(8, 11,  0) },
    { contactId: angela.id,   duration: 89,  disposition: 'not-interested',     notes: 'Renewed lease. Not moving.',                                        calledAt: daysAgo(8, 14,  0) },
    // Day 9
    { contactId: beverly.id,  duration: 167, disposition: 'callback-scheduled', notes: 'Reconsidering after market update.',                                calledAt: daysAgo(9, 10,  0) },
    { contactId: richard.id,  duration: 211, disposition: 'callback-scheduled', notes: 'Moving out of state. Timeline 4-6 months.',                         calledAt: daysAgo(9, 14,  0) },
    { contactId: maria.id,    duration: 0,   disposition: 'not-home',           notes: '',                                                                  calledAt: daysAgo(9, 15,  0) },
    // Day 10
    { contactId: james.id,    duration: 0,   disposition: 'not-home',           notes: '',                                                                  calledAt: daysAgo(10,  9,  0) },
    { contactId: charles.id,  duration: 45,  disposition: 'left-voicemail',     notes: 'Confirming interest from previous call.',                           calledAt: daysAgo(10, 11,  0) },
    { contactId: kevin.id,    duration: 0,   disposition: 'not-home',           notes: '',                                                                  calledAt: daysAgo(10, 14,  0) },
    { contactId: daniel.id,   duration: 55,  disposition: 'left-voicemail',     notes: 'Left market update VM.',                                            calledAt: daysAgo(10, 15,  0) },
    // Day 11
    { contactId: james.id,    duration: 221, disposition: 'hot-lead',           notes: 'Initial strong call. Very interested.',                             calledAt: daysAgo(11, 10,  0) },
    { contactId: linda.id,    duration: 0,   disposition: 'not-home',           notes: '',                                                                  calledAt: daysAgo(11, 11,  0) },
    { contactId: maria.id,    duration: 144, disposition: 'callback-scheduled', notes: 'Called to introduce myself. Set follow-up.',                        calledAt: daysAgo(11, 14,  0) },
    // Day 12
    { contactId: michael.id,  duration: 156, disposition: 'callback-scheduled', notes: 'Initial contact. Very interested in listings.',                     calledAt: daysAgo(12,  9,  0) },
    { contactId: robert.id,   duration: 0,   disposition: 'not-home',           notes: '',                                                                  calledAt: daysAgo(12,  9, 30) },
    { contactId: tamara.id,   duration: 88,  disposition: 'callback-scheduled', notes: 'Will call after vacation.',                                         calledAt: daysAgo(12, 11,  0) },
    { contactId: gregory.id,  duration: 0,   disposition: 'not-home',           notes: '',                                                                  calledAt: daysAgo(12, 14,  0) },
    // Day 13
    { contactId: jennifer.id, duration: 0,   disposition: 'not-home',           notes: '',                                                                  calledAt: daysAgo(13,  9, 30) },
    { contactId: beverly.id,  duration: 0,   disposition: 'not-home',           notes: '',                                                                  calledAt: daysAgo(13, 10,  0) },
    { contactId: david.id,    duration: 102, disposition: 'left-voicemail',     notes: 'Left VM, introduced myself.',                                       calledAt: daysAgo(13, 15,  0) },
  ];

  for (const c of callData) {
    await prisma.call.create({ data: c });
  }
  console.log('✅ Calls created:', callData.length);

  // ── Messages ────────────────────────────────────────────────────────────────
  const msgData = [
    { contactId: james.id,    direction: 'outbound', fromNumber: '+14439091704', toNumber: james.phone,    body: 'Hi James! This is Braddock Jones. I saw your home at 1842 Ridgewood came off the market. I specialize in this neighborhood and have sold 8 homes in your zip in the last 90 days. Would love to share a plan!', sentAt: daysAgo(4), status: 'sent' },
    { contactId: james.id,    direction: 'inbound',  fromNumber: james.phone,    toNumber: '+14439091704', body: 'Hey Braddock, yeah we were frustrated with the last agent. Open to hearing your plan.', sentAt: daysAgo(3), status: 'sent' },
    { contactId: james.id,    direction: 'outbound', fromNumber: '+14439091704', toNumber: james.phone,    body: 'Great! I have sold 8 homes in your zip in the last 90 days. Can we meet Thursday at 6pm?', sentAt: daysAgo(3), status: 'sent' },
    { contactId: james.id,    direction: 'inbound',  fromNumber: james.phone,    toNumber: '+14439091704', body: 'Thursday works. See you then.', sentAt: daysAgo(3), status: 'sent' },
    { contactId: james.id,    direction: 'outbound', fromNumber: '+14439091704', toNumber: james.phone,    body: 'Perfect! I will bring the full CMA and a net proceeds sheet. See you Thursday at 6!', sentAt: daysAgo(3), status: 'sent' },
    { contactId: michael.id,  direction: 'outbound', fromNumber: '+14439091704', toNumber: michael.phone,  body: 'Michael! Great talking today. Sending you listings in Columbia matching your criteria right now.', sentAt: daysAgo(0), status: 'sent' },
    { contactId: michael.id,  direction: 'inbound',  fromNumber: michael.phone,  toNumber: '+14439091704', body: 'Perfect, looking forward to it. The one on Broken Land Pkwy looks amazing!', sentAt: daysAgo(0), status: 'sent' },
    { contactId: michael.id,  direction: 'outbound', fromNumber: '+14439091704', toNumber: michael.phone,  body: 'That one just came on! Want to tour it this weekend?', sentAt: daysAgo(0), status: 'sent' },
    { contactId: michael.id,  direction: 'inbound',  fromNumber: michael.phone,  toNumber: '+14439091704', body: 'Yes! Saturday morning works.', sentAt: daysAgo(0), status: 'sent' },
    { contactId: maria.id,    direction: 'outbound', fromNumber: '+14439091704', toNumber: maria.phone,    body: 'Hi Maria, Braddock Jones here. Happy to answer any questions before you talk to your husband!', sentAt: daysAgo(2), status: 'sent' },
    { contactId: maria.id,    direction: 'inbound',  fromNumber: maria.phone,    toNumber: '+14439091704', body: 'He is onboard. Can we do Saturday morning?', sentAt: daysAgo(1), status: 'sent' },
    { contactId: maria.id,    direction: 'outbound', fromNumber: '+14439091704', toNumber: maria.phone,    body: 'Saturday at 9am works perfectly! 3310 Elm Street, Towson. See you then!', sentAt: daysAgo(1), status: 'sent' },
    { contactId: jennifer.id, direction: 'outbound', fromNumber: '+14439091704', toNumber: jennifer.phone, body: 'Hi Jennifer! Braddock here. Great chatting. Confirming our call for next Friday at 11am.', sentAt: daysAgo(3), status: 'sent' },
    { contactId: jennifer.id, direction: 'inbound',  fromNumber: jennifer.phone, toNumber: '+14439091704', body: 'Yes confirmed! Looking forward to it.', sentAt: daysAgo(2), status: 'sent' },
    { contactId: marcus.id,   direction: 'outbound', fromNumber: '+14439091704', toNumber: marcus.phone,   body: 'Marcus — great call today! Sending you my calendar link for next week.', sentAt: daysAgo(2), status: 'sent' },
    { contactId: marcus.id,   direction: 'inbound',  fromNumber: marcus.phone,   toNumber: '+14439091704', body: 'Got it. Tuesday at 2pm works.', sentAt: daysAgo(2), status: 'sent' },
    { contactId: kevin.id,    direction: 'outbound', fromNumber: '+14439091704', toNumber: kevin.phone,    body: 'Hi Kevin! Braddock Jones here. Would a buyer\'s agent commission make sense for your situation?', sentAt: daysAgo(4), status: 'sent' },
    { contactId: kevin.id,    direction: 'inbound',  fromNumber: kevin.phone,    toNumber: '+14439091704', body: 'Honestly the house has been sitting for 6 weeks. Maybe. Can we talk?', sentAt: daysAgo(4), status: 'sent' },
    { contactId: nancy.id,    direction: 'outbound', fromNumber: '+14439091704', toNumber: nancy.phone,    body: 'Nancy — great news! Based on recent sales near 850 Eutaw, your home could net $340k+ after fees. Let me know if you want the full breakdown.', sentAt: daysAgo(5), status: 'sent' },
    { contactId: nancy.id,    direction: 'inbound',  fromNumber: nancy.phone,    toNumber: '+14439091704', body: 'That is much more than I expected! Yes please send that over.', sentAt: daysAgo(5), status: 'sent' },
  ];

  for (const m of msgData) await prisma.message.create({ data: m });
  console.log('✅ Messages created:', msgData.length);

  // ── Appointments ────────────────────────────────────────────────────────────
  const apptData = [
    { contactId: james.id,    title: 'Listing Appointment',    scheduledAt: future(2, 18), duration: 60, location: '1842 Ridgewood Dr, Baltimore MD',  notes: 'Bring CMA and net sheet. Owner is motivated.',         status: 'confirmed', smsSent: true  },
    { contactId: michael.id,  title: 'Buyer Home Tour',        scheduledAt: future(3, 10), duration: 90, location: '1400 Broken Land Pkwy, Columbia MD', notes: 'Pre-approved $650k. Tour 3 homes Saturday.',          status: 'confirmed', smsSent: true  },
    { contactId: maria.id,    title: 'Listing Presentation',   scheduledAt: future(5,  9), duration: 60, location: '3310 Elm Street, Towson MD',        notes: 'Both spouses present. Bring comps for Towson area.',   status: 'confirmed', smsSent: false },
    { contactId: marcus.id,   title: 'Listing Appointment',    scheduledAt: future(6, 14), duration: 60, location: '1221 Dundalk Ave, Baltimore MD',    notes: 'Urgent — needs to close in 45 days.',                  status: 'confirmed', smsSent: true  },
    { contactId: jennifer.id, title: 'Strategy Call',          scheduledAt: future(7, 11), duration: 30, location: 'Phone call',                        notes: 'Spring listing discussion. She is very warm.',         status: 'confirmed', smsSent: false },
    { contactId: charles.id,  title: 'Listing Appointment',    scheduledAt: future(9, 13), duration: 60, location: '520 Hillen Rd, Towson MD',          notes: 'Job relocation — motivated to sell in 60 days.',       status: 'confirmed', smsSent: true  },
  ];

  for (const a of apptData) await prisma.appointment.create({ data: a });
  console.log('✅ Appointments created:', apptData.length);

  // ── Email Templates ─────────────────────────────────────────────────────────
  await prisma.emailTemplate.createMany({
    data: [
      {
        name: 'Hot Lead Follow-Up',
        subject: 'Your Home Value — {{address}}',
        body: '<p>Hi {{firstName}},</p><p>It was great connecting today. Based on recent sales near {{address}}, I believe your home could sell for <strong>$340,000–$365,000</strong> in today\'s market — and with my marketing strategy, we typically see offers within the first 10 days.</p><p>Can we find 20 minutes this week to walk through my plan?</p><p>— Braddock Jones<br>443-909-1704</p>',
        trigger: 'hot-lead',
      },
      {
        name: 'Callback Confirmation',
        subject: 'Looking forward to our call, {{firstName}}!',
        body: '<p>Hi {{firstName}},</p><p>Just confirming our scheduled callback. I will call you at the number we discussed.</p><p>In the meantime, feel free to reach out with any questions.</p><p>Talk soon!<br>— Braddock Jones</p>',
        trigger: 'callback',
      },
      {
        name: 'No Answer Follow-Up',
        subject: 'Tried to reach you — Braddock Jones',
        body: '<p>Hi {{firstName}},</p><p>I tried calling earlier but missed you. I specialize in helping homeowners in your area and would love to connect.</p><p>Feel free to reply here or call me directly at (443) 909-1704.</p><p>— Braddock Jones</p>',
        trigger: 'no-answer',
      },
    ],
  });
  console.log('✅ Email templates created');

  console.log('\n✨ Demo seed complete! Ready for investor presentation.\n');
  console.log('📊 Summary:');
  console.log(`   ${contactData.length} contacts across 5 sources`);
  console.log(`   ${callData.length} calls over 14 days`);
  console.log(`   ${msgData.length} SMS messages`);
  console.log(`   ${apptData.length} upcoming appointments`);
  console.log('   3 email templates\n');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
