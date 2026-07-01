// ─── Context Builder ─────────────────────────────────────────────────────────
// Assembles everything the agent should "see" about a contact (Lesson: context
// engineering). Kept small and relevant, not a data dump.
import prisma from '../db';

export async function buildContactContext(contactId: string) {
  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    include: {
      calls: { orderBy: { calledAt: 'desc' }, take: 5 },
      messages: { orderBy: { sentAt: 'desc' }, take: 12 },
      appointments: { orderBy: { scheduledAt: 'desc' }, take: 3 },
    },
  });
  if (!contact) throw new Error('Contact not found');

  const thread = [...contact.messages]
    .sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime())
    .map((m) => `${m.direction === 'inbound' ? 'LEAD' : 'AGENT'}: ${m.body}`)
    .join('\n');

  const callSummary = contact.calls.length
    ? contact.calls.map((c) => `${c.calledAt.toLocaleDateString()}: ${c.disposition || 'no disposition'} (${c.duration}s)`).join('; ')
    : 'No calls yet';

  const lastInbound = contact.messages.find((m) => m.direction === 'inbound');
  const upcomingAppt = contact.appointments.find((a) => a.status === 'confirmed' && a.scheduledAt > new Date());

  return {
    contact,
    thread,
    callSummary,
    lastInboundText: lastInbound?.body || '',
    hasUpcomingAppointment: !!upcomingAppt,
    profile: [
      `Name: ${contact.firstName} ${contact.lastName}`,
      `Phone: ${contact.phone}`,
      `Property: ${contact.address || 'unknown'}, ${contact.city || ''} ${contact.state || ''}`.trim(),
      `Source: ${contact.source} | Status: ${contact.status} | Lead score: ${contact.leadScore ?? 'unscored'}/100`,
      contact.email ? `Email: ${contact.email}` : '',
    ].filter(Boolean).join('\n'),
  };
}
