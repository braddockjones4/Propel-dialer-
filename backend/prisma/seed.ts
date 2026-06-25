/**
 * Propel Dialer — Demo Seed
 * Run: npx ts-node prisma/seed.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding demo data...');

  await (prisma as any).call.deleteMany({});
  await (prisma as any).message.deleteMany({});
  await (prisma as any).appointment.deleteMany({});
  await (prisma as any).contact.deleteMany({});

  const contacts = await (prisma as any).contact.createMany({
    data: [
      { firstName: 'James',    lastName: 'Patterson',  phone: '+14435550101', address: '1842 Ridgewood Dr',     city: 'Baltimore',    state: 'MD', zip: '21201', source: 'expired',     status: 'hot',       leadScore: 88, email: 'jpatterson@gmail.com' },
      { firstName: 'Maria',    lastName: 'Gonzalez',   phone: '+14435550102', address: '3310 Elm Street',       city: 'Towson',       state: 'MD', zip: '21204', source: 'expired',     status: 'callback',  leadScore: 74, email: 'mgonzalez@yahoo.com' },
      { firstName: 'Thomas',   lastName: 'Whitfield',  phone: '+14435550110', address: '5820 Harford Rd',       city: 'Baltimore',    state: 'MD', zip: '21214', source: 'expired',     status: 'contacted', leadScore: 61 },
      { firstName: 'Beverly',  lastName: 'Simmons',    phone: '+14435550111', address: '712 Dulaney Valley Rd', city: 'Towson',       state: 'MD', zip: '21286', source: 'expired',     status: 'new',       leadScore: 45 },
      { firstName: 'Richard',  lastName: 'Thornton',   phone: '+14435550112', address: '3041 Bel Air Rd',       city: 'Baltimore',    state: 'MD', zip: '21213', source: 'expired',     status: 'new',       leadScore: 39 },
      { firstName: 'Robert',   lastName: 'Chen',       phone: '+14435550103', address: '504 Maple Ave',         city: 'Catonsville',  state: 'MD', zip: '21228', source: 'fsbo',        status: 'contacted', leadScore: 55, email: 'rchen@outlook.com' },
      { firstName: 'Sandra',   lastName: 'Williams',   phone: '+14435550104', address: '721 Oak Lane',          city: 'Ellicott City',state: 'MD', zip: '21042', source: 'fsbo',        status: 'new',       leadScore: 42 },
      { firstName: 'Kevin',    lastName: 'OBrien',     phone: '+14435550113', address: '1590 Frederick Rd',     city: 'Catonsville',  state: 'MD', zip: '21228', source: 'fsbo',        status: 'new',       leadScore: 38 },
      { firstName: 'Patricia', lastName: 'Lawson',     phone: '+14435550114', address: '88 Ingleside Ave',      city: 'Baltimore',    state: 'MD', zip: '21228', source: 'fsbo',        status: 'contacted', leadScore: 52 },
      { firstName: 'David',    lastName: 'Thompson',   phone: '+14435550105', address: '29 Harbor View Rd',     city: 'Annapolis',    state: 'MD', zip: '21401', source: 'circle',      status: 'new',       leadScore: 31 },
      { firstName: 'Linda',    lastName: 'Martinez',   phone: '+14435550106', address: '118 Sunrise Blvd',      city: 'Glen Burnie',  state: 'MD', zip: '21061', source: 'circle',      status: 'new',       leadScore: 28 },
      { firstName: 'Gregory',  lastName: 'Holt',       phone: '+14435550115', address: '2204 Northern Pkwy',    city: 'Baltimore',    state: 'MD', zip: '21210', source: 'circle',      status: 'new',       leadScore: 22 },
      { firstName: 'Angela',   lastName: 'Foster',     phone: '+14435550116', address: '441 Stevenson Rd',      city: 'Baltimore',    state: 'MD', zip: '21212', source: 'circle',      status: 'new',       leadScore: 19 },
      { firstName: 'Michael',  lastName: 'Johnson',    phone: '+14435550107', address: '660 Pinecrest Dr',      city: 'Columbia',     state: 'MD', zip: '21044', source: 'past-client', status: 'hot',       leadScore: 91, email: 'mjohnson@gmail.com' },
      { firstName: 'Patricia', lastName: 'Davis',      phone: '+14435550108', address: '3024 Joes Rd',          city: 'Albany',       state: 'NY', zip: '12207', source: 'past-client', status: 'new',       leadScore: 67, email: 'pdavis@icloud.com' },
      { firstName: 'Jennifer', lastName: 'Walsh',      phone: '+14435550117', address: '1140 River Rd',         city: 'Annapolis',    state: 'MD', zip: '21409', source: 'past-client', status: 'callback',  leadScore: 72, email: 'jwalsh@gmail.com' },
      { firstName: 'Charles',  lastName: 'Monroe',     phone: '+14435550118', address: '520 Hillen Rd',         city: 'Towson',       state: 'MD', zip: '21286', source: 'past-client', status: 'contacted', leadScore: 58 },
      { firstName: 'Nancy',    lastName: 'Carter',     phone: '+14435550109', address: '850 Eutaw Place',       city: 'Baltimore',    state: 'MD', zip: '21201', source: 'manual',      status: 'new',       leadScore: 33 },
      { firstName: 'Daniel',   lastName: 'Brooks',     phone: '+14435550119', address: '3312 Belvieu Ave',      city: 'Baltimore',    state: 'MD', zip: '21215', source: 'manual',      status: 'contacted', leadScore: 44 },
      { firstName: 'Susan',    lastName: 'Grant',      phone: '+14435550120', address: '744 Edmondson Ave',     city: 'Baltimore',    state: 'MD', zip: '21228', source: 'manual',      status: 'new',       leadScore: 29 },
    ],
  });
  console.log('Contacts created:', contacts.count);

  const all = await (prisma as any).contact.findMany({ orderBy: { createdAt: 'asc' } });
  const get = (fn: string, ln: string) => all.find((c: any) => c.firstName === fn && c.lastName === ln);

  const james    = get('James',    'Patterson');
  const maria    = get('Maria',    'Gonzalez');
  const michael  = get('Michael',  'Johnson');
  const jennifer = get('Jennifer', 'Walsh');
  const robert   = get('Robert',   'Chen');
  const thomas   = get('Thomas',   'Whitfield');
  const patricia = get('Patricia', 'Davis');

  const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString(); };
  const future  = (n: number, h: number) => { const d = new Date(); d.setDate(d.getDate() + n); d.setHours(h, 0, 0, 0); return d.toISOString(); };

  // Calls
  const callData = [
    james    && { contactId: james.id,    duration: 187, disposition: 'hot-lead',           notes: 'Very motivated. Wants to list ASAP. Sending CMA tomorrow.',              calledAt: daysAgo(1) },
    james    && { contactId: james.id,    duration: 43,  disposition: 'not-home',            notes: 'No answer, left voicemail.',                                             calledAt: daysAgo(4) },
    maria    && { contactId: maria.id,    duration: 124, disposition: 'callback-scheduled',  notes: 'Interested but needs to talk to husband. Call back Thursday.',           calledAt: daysAgo(2) },
    michael  && { contactId: michael.id,  duration: 312, disposition: 'hot-lead',            notes: 'Ready to upgrade. Pre-approved $650k. Wants 4BR in Columbia.',          calledAt: daysAgo(0) },
    michael  && { contactId: michael.id,  duration: 98,  disposition: 'not-home',            notes: 'Left VM.',                                                               calledAt: daysAgo(7) },
    jennifer && { contactId: jennifer.id, duration: 201, disposition: 'callback-scheduled',  notes: 'Thinking about selling in spring.',                                      calledAt: daysAgo(3) },
    robert   && { contactId: robert.id,   duration: 67,  disposition: 'not-interested',      notes: 'Listed with another agent.',                                             calledAt: daysAgo(5) },
    thomas   && { contactId: thomas.id,   duration: 155, disposition: 'left-voicemail',      notes: 'Left detailed voicemail about marketing plan.',                          calledAt: daysAgo(1) },
    thomas   && { contactId: thomas.id,   duration: 0,   disposition: 'not-home',            notes: 'No answer.',                                                             calledAt: daysAgo(6) },
    patricia && { contactId: patricia.id, duration: 245, disposition: 'hot-lead',            notes: 'Motivated seller — divorce situation. Needs quick close.',               calledAt: daysAgo(2) },
  ].filter(Boolean) as any[];

  for (const c of callData) await (prisma as any).call.create({ data: c });
  console.log('Calls created:', callData.length);

  // Messages
  const msgData = [
    james   && { contactId: james.id,   direction: 'outbound', fromNumber: '+14439091704', toNumber: '+14435550101', body: 'Hi James! This is Braddock Jones. I saw your home at 1842 Ridgewood came off the market. Would love to share a plan to get it sold fast!', sentAt: daysAgo(4), status: 'sent' },
    james   && { contactId: james.id,   direction: 'inbound',  fromNumber: '+14435550101', toNumber: '+14439091704', body: 'Hey Braddock, yeah we were frustrated with the last agent. Open to hearing your plan.',                                                       sentAt: daysAgo(3), status: 'sent' },
    james   && { contactId: james.id,   direction: 'outbound', fromNumber: '+14439091704', toNumber: '+14435550101', body: 'I have sold 8 homes in your zip in the last 90 days. Can we meet Thursday at 6pm?',                                                          sentAt: daysAgo(3), status: 'sent' },
    james   && { contactId: james.id,   direction: 'inbound',  fromNumber: '+14435550101', toNumber: '+14439091704', body: 'Thursday works. See you then.',                                                                                                               sentAt: daysAgo(3), status: 'sent' },
    michael && { contactId: michael.id, direction: 'outbound', fromNumber: '+14439091704', toNumber: '+14435550107', body: 'Michael! Great talking today. Sending you listings in Columbia matching your criteria now.',                                                   sentAt: daysAgo(0), status: 'sent' },
    michael && { contactId: michael.id, direction: 'inbound',  fromNumber: '+14435550107', toNumber: '+14439091704', body: 'Perfect, looking forward to it. The one on Broken Land Pkwy looks great!',                                                                    sentAt: daysAgo(0), status: 'sent' },
    maria   && { contactId: maria.id,   direction: 'outbound', fromNumber: '+14439091704', toNumber: '+14435550102', body: 'Hi Maria, Braddock Jones here. Happy to answer any questions before you talk to your husband!',                                               sentAt: daysAgo(2), status: 'sent' },
    maria   && { contactId: maria.id,   direction: 'inbound',  fromNumber: '+14435550102', toNumber: '+14439091704', body: 'He is onboard. Can we do Saturday morning?',                                                                                                  sentAt: daysAgo(1), status: 'sent' },
  ].filter(Boolean) as any[];

  for (const m of msgData) await (prisma as any).message.create({ data: m });
  console.log('Messages created:', msgData.length);

  // Appointments
  const apptData = [
    james    && { contactId: james.id,    title: 'Listing Appointment',  scheduledAt: future(2, 18), duration: 60, location: '1842 Ridgewood Dr, Baltimore MD',  notes: 'Bring CMA and net sheet',          status: 'scheduled', smsSent: true  },
    michael  && { contactId: michael.id,  title: 'Buyer Consultation',   scheduledAt: future(3, 10), duration: 90, location: '660 Pinecrest Dr, Columbia MD',     notes: 'Pre-approved $650k, wants 4BR',    status: 'scheduled', smsSent: true  },
    maria    && { contactId: maria.id,    title: 'Listing Presentation', scheduledAt: future(5, 9),  duration: 60, location: '3310 Elm Street, Towson MD',        notes: 'Both spouses will be present',     status: 'scheduled', smsSent: false },
    jennifer && { contactId: jennifer.id, title: 'Follow-Up Call',       scheduledAt: future(7, 11), duration: 30, location: 'Phone call',                        notes: 'Spring listing discussion',        status: 'scheduled', smsSent: false },
  ].filter(Boolean) as any[];

  for (const a of apptData) await (prisma as any).appointment.create({ data: a });
  console.log('Appointments created:', apptData.length);

  console.log('\n✨ Demo seed complete!\n');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
