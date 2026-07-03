// ─── Services Landing Page ────────────────────────────────────────────────────
// propeldialer.com — repositioned as a bespoke AI automation studio for
// real estate agents. Not a SaaS signup. Proof-led, boutique feel.
import React, { useState, useEffect, useRef } from 'react';

interface Props { onSignIn: () => void }

const GOLD     = '#C9A84C';
const GOLDDARK = '#9A7A2E';
const BLACK    = '#0A0A0A';
const GRAY     = '#6B7280';

// ── Reusable styles ───────────────────────────────────────────────────────────
const btnGold: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 8,
  padding: '15px 40px',
  background: GOLD, color: '#fff', border: 'none', borderRadius: 3,
  fontSize: 11, fontWeight: 700, letterSpacing: '0.2em', textTransform: 'uppercase',
  cursor: 'pointer', transition: 'all 0.25s',
};
const btnOutline: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 8,
  padding: '15px 40px',
  background: 'transparent', color: '#fff',
  border: '1px solid rgba(255,255,255,0.35)', borderRadius: 3,
  fontSize: 11, fontWeight: 600, letterSpacing: '0.2em', textTransform: 'uppercase',
  cursor: 'pointer', transition: 'all 0.25s',
};

// ── Contact form state ────────────────────────────────────────────────────────
interface FormState { name: string; email: string; role: string; message: string }

export default function Landing({ onSignIn }: Props) {
  const [scrolled, setScrolled]   = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [form, setForm]           = useState<FormState>({ name: '', email: '', role: '', message: '' });
  const [formSent, setFormSent]   = useState(false);
  const [formLoading, setFormLoading] = useState(false);
  const contactRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 50);
    window.addEventListener('scroll', fn);
    return () => window.removeEventListener('scroll', fn);
  }, []);

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
    setMobileOpen(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormLoading(true);
    // Open mail client with form data pre-filled
    const subject = encodeURIComponent(`Inquiry from ${form.name} — ${form.role}`);
    const body = encodeURIComponent(
      `Name: ${form.name}\nEmail: ${form.email}\nRole: ${form.role}\n\n${form.message}`
    );
    window.open(`mailto:Braddockjones4@icloud.com?subject=${subject}&body=${body}`);
    setTimeout(() => {
      setFormLoading(false);
      setFormSent(true);
    }, 600);
  };

  const NAV_LINKS = ['Work', 'Services', 'Contact'];

  return (
    <div style={{ fontFamily: "'Inter', sans-serif", background: '#fff', color: BLACK, lineHeight: 1.6, WebkitFontSmoothing: 'antialiased' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300;1,400&family=Inter:wght@300;400;500;600&display=swap');
        .serif { font-family: 'Cormorant Garamond', serif !important; }
        .gold-rule { width: 36px; height: 1px; background: ${GOLD}; margin: 0 auto 20px; }
        .gold-rule-left { width: 36px; height: 1px; background: ${GOLD}; margin: 0 0 20px; }
        .nav-lnk { font-size: 10px; font-weight: 600; letter-spacing: 0.18em; text-transform: uppercase; background: none; border: none; cursor: pointer; transition: color 0.2s; padding: 0; }
        .service-card { background: #fff; border: 1px solid rgba(0,0,0,0.08); border-radius: 10px; padding: 36px 32px; transition: all 0.2s; }
        .service-card:hover { transform: translateY(-3px); box-shadow: 0 20px 56px rgba(0,0,0,0.07); border-color: rgba(201,168,76,0.28); }
        .form-input { width: 100%; padding: 13px 16px; border: 1.5px solid rgba(0,0,0,0.1); border-radius: 6px; font-size: 13.5px; font-family: inherit; color: #111; background: #fafafa; outline: none; transition: border-color 0.2s; box-sizing: border-box; }
        .form-input:focus { border-color: ${GOLD}; background: #fff; }
        .form-input::placeholder { color: #aaa; }
        @keyframes fade-up { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
        .fade-up { animation: fade-up 0.55s ease forwards; }
        @media (max-width: 640px) {
          .hero-h1 { font-size: 48px !important; }
          .grid-2 { grid-template-columns: 1fr !important; }
          .grid-3 { grid-template-columns: 1fr !important; }
          .nav-desktop { display: none !important; }
          .nav-burger { display: block !important; }
          .hero-btns { flex-direction: column !important; align-items: stretch !important; }
          .hero-btns button { text-align: center; justify-content: center; }
          .process-grid { grid-template-columns: 1fr 1fr !important; }
        }
      `}</style>

      {/* ── NAV ──────────────────────────────────────────────────────────────── */}
      <nav style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 200,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 48px', height: 62,
        background: scrolled ? 'rgba(255,255,255,0.97)' : 'transparent',
        backdropFilter: scrolled ? 'blur(16px)' : 'none',
        borderBottom: scrolled ? '1px solid rgba(201,168,76,0.15)' : 'none',
        transition: 'all 0.3s ease',
      }}>
        <span className="serif" style={{ fontSize: 18, fontWeight: 300, letterSpacing: '0.55em', color: scrolled ? BLACK : '#fff' }}>
          PROPEL
        </span>

        <div className="nav-desktop" style={{ display: 'flex', alignItems: 'center', gap: 36 }}>
          {NAV_LINKS.map(label => (
            <button key={label} className="nav-lnk"
              onClick={() => scrollTo(label.toLowerCase())}
              style={{ color: scrolled ? GRAY : 'rgba(255,255,255,0.65)' }}
              onMouseEnter={e => (e.currentTarget.style.color = scrolled ? BLACK : '#fff')}
              onMouseLeave={e => (e.currentTarget.style.color = scrolled ? GRAY : 'rgba(255,255,255,0.65)')}>
              {label}
            </button>
          ))}
          <button onClick={onSignIn} style={{
            fontSize: 10, fontWeight: 600, letterSpacing: '0.15em', textTransform: 'uppercase',
            padding: '7px 18px', borderRadius: 4, border: `1px solid ${scrolled ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.3)'}`,
            background: 'transparent', color: scrolled ? GRAY : 'rgba(255,255,255,0.65)',
            cursor: 'pointer', transition: 'all 0.2s',
          }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = GOLD; e.currentTarget.style.color = GOLD; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = scrolled ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.3)'; e.currentTarget.style.color = scrolled ? GRAY : 'rgba(255,255,255,0.65)'; }}>
            Client Login
          </button>
        </div>

        <button className="nav-burger" onClick={() => setMobileOpen(o => !o)}
          style={{ display: 'none', background: 'none', border: 'none', cursor: 'pointer', fontSize: 21, color: scrolled ? BLACK : '#fff' }}>
          {mobileOpen ? '✕' : '☰'}
        </button>
      </nav>

      {mobileOpen && (
        <div style={{ position: 'fixed', top: 62, left: 0, right: 0, zIndex: 199, background: '#fff', borderBottom: '1px solid #f0f0f0', padding: '8px 0 16px' }}>
          {NAV_LINKS.map(label => (
            <button key={label} onClick={() => scrollTo(label.toLowerCase())}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '13px 28px', background: 'none', border: 'none', fontSize: 11, fontWeight: 600, letterSpacing: '0.15em', textTransform: 'uppercase', color: GRAY, cursor: 'pointer' }}>
              {label}
            </button>
          ))}
          <div style={{ padding: '8px 28px 0', display: 'flex', gap: 10 }}>
            <button onClick={() => scrollTo('contact')} style={{ ...btnGold, flex: 1, justifyContent: 'center', padding: '12px 20px' }}>
              Get in Touch
            </button>
            <button onClick={onSignIn} style={{ padding: '12px 20px', borderRadius: 3, border: '1px solid rgba(0,0,0,0.12)', background: 'transparent', fontSize: 10, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: GRAY, cursor: 'pointer' }}>
              Login
            </button>
          </div>
        </div>
      )}

      {/* ── HERO ─────────────────────────────────────────────────────────────── */}
      <section style={{
        position: 'relative', minHeight: '100vh',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        textAlign: 'center', overflow: 'hidden',
        background: BLACK,
      }}>
        <div style={{ position: 'absolute', inset: 0, zIndex: 0 }}>
          <img
            src="https://images.unsplash.com/photo-1762979790868-3bf9153b84cc?auto=format&fit=crop&w=1600&q=80"
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 40%', display: 'block' }}
          />
        </div>
        <div style={{ position: 'absolute', inset: 0, zIndex: 1, background: 'linear-gradient(to bottom, rgba(5,5,5,0.72) 0%, rgba(5,5,5,0.55) 55%, rgba(5,5,5,0.82) 100%)' }} />

        <div className="fade-up" style={{ position: 'relative', zIndex: 2, padding: '160px 24px 140px', maxWidth: 820, margin: '0 auto' }}>
          <div style={{ display: 'inline-block', fontSize: 9.5, fontWeight: 700, letterSpacing: '0.35em', textTransform: 'uppercase', color: GOLD, marginBottom: 28, padding: '5px 14px', border: `1px solid rgba(201,168,76,0.3)`, borderRadius: 20 }}>
            AI Automation for Real Estate
          </div>

          <h1 className="hero-h1 serif" style={{
            fontSize: 'clamp(48px, 7.5vw, 90px)', fontWeight: 300,
            lineHeight: 1.05, letterSpacing: '0.02em', color: '#fff',
            marginBottom: 30,
          }}>
            Your leads don't stop<br />
            at <em style={{ fontStyle: 'italic', color: GOLD }}>5 o'clock.</em>
          </h1>

          <p style={{
            fontSize: 'clamp(15px, 1.8vw, 18px)', fontWeight: 300,
            color: 'rgba(255,255,255,0.75)', maxWidth: 480, margin: '0 auto 48px',
            lineHeight: 1.85, letterSpacing: '0.01em',
          }}>
            I build custom AI systems that follow up with your leads, qualify them by text, 
            and book listing appointments — around the clock, without a team.
          </p>

          <div className="hero-btns" style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button onClick={() => scrollTo('contact')} style={btnGold}
              onMouseEnter={e => (e.currentTarget.style.background = GOLDDARK)}
              onMouseLeave={e => (e.currentTarget.style.background = GOLD)}>
              Start a Conversation →
            </button>
            <button onClick={() => scrollTo('work')} style={btnOutline}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.07)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
              See the Work
            </button>
          </div>
        </div>

        {/* Bottom stat bar */}
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 2,
          display: 'flex', justifyContent: 'center',
          background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(12px)',
          borderTop: '1px solid rgba(201,168,76,0.12)',
        }}>
          {[
            { val: 'Custom', label: 'Built for your workflow' },
            { val: '24 / 7', label: 'Always-on automation' },
            { val: 'Retainer', label: 'Ongoing maintenance & support' },
          ].map(({ val, label }, i) => (
            <div key={label} style={{
              flex: 1, maxWidth: 260, textAlign: 'center', padding: '22px 20px',
              borderLeft: i > 0 ? '1px solid rgba(255,255,255,0.06)' : 'none',
            }}>
              <div className="serif" style={{ fontSize: 28, fontWeight: 300, color: GOLD, lineHeight: 1 }}>{val}</div>
              <div style={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.35)', marginTop: 7 }}>{label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── INTRO STATEMENT ──────────────────────────────────────────────────── */}
      <section style={{ padding: '110px 24px', background: '#fafaf8' }}>
        <div style={{ maxWidth: 760, margin: '0 auto', textAlign: 'center' }}>
          <div className="gold-rule" />
          <h2 className="serif" style={{ fontSize: 'clamp(30px, 4.5vw, 50px)', fontWeight: 300, color: BLACK, lineHeight: 1.2, marginBottom: 28 }}>
            Most real estate agents spend their best hours{' '}
            <em style={{ fontStyle: 'italic', color: GOLDDARK }}>chasing people who aren't ready to list.</em>
          </h2>
          <p style={{ fontSize: 16, color: GRAY, lineHeight: 1.9, maxWidth: 600, margin: '0 auto 20px' }}>
            The agents who win aren't working harder — they have systems that work while they don't. 
            I build those systems: custom AI that dials, texts, qualifies, and books so you can focus on 
            the appointments, not the chase.
          </p>
          <p style={{ fontSize: 15, color: GRAY, lineHeight: 1.9, maxWidth: 600, margin: '0 auto' }}>
            This isn't software you sign up for. It's a system I build for your business, 
            tuned to how you work, and maintained so it keeps performing.
          </p>
        </div>
      </section>

      {/* ── PROOF / CASE STUDY ───────────────────────────────────────────────── */}
      <section id="work" style={{ padding: '110px 24px', background: BLACK }}>
        <div style={{ maxWidth: 1060, margin: '0 auto' }}>
          <div style={{ maxWidth: 560, marginBottom: 64 }}>
            <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.35em', textTransform: 'uppercase', color: GOLD, marginBottom: 16 }}>Live Work</div>
            <div className="gold-rule-left" />
            <h2 className="serif" style={{ fontSize: 'clamp(30px, 4vw, 48px)', fontWeight: 300, color: '#fff', lineHeight: 1.1, marginBottom: 20 }}>
              Here's what a finished<br /><em style={{ fontStyle: 'italic', color: GOLD }}>system looks like.</em>
            </h2>
            <p style={{ fontSize: 15, color: 'rgba(255,255,255,0.5)', lineHeight: 1.85 }}>
              Propel is a fully operational AI dialing and follow-up system built for a 
              real estate agent — running live, booking real appointments. This is the caliber 
              of system I build for every client.
            </p>
          </div>

          <div className="grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, alignItems: 'start' }}>
            {/* What it does */}
            <div>
              {[
                { icon: '📞', title: 'Triple-Line Power Dialer', desc: 'Calls three leads simultaneously. Connects instantly the moment someone picks up. Drops a voicemail automatically on no-answer.' },
                { icon: '🤖', title: 'AI-Generated Call Scripts', desc: 'Every contact gets a personalized opener, objection handlers, and a close — generated before the dial, updated after every call.' },
                { icon: '💬', title: 'Automated SMS Follow-Up', desc: 'The moment a call ends, a personalized text goes out. Sequences run in the background for weeks — without a single manual touchpoint.' },
                { icon: '🧠', title: 'Autonomous AI Agent', desc: 'Responds to inbound texts, qualifies leads, and books appointments — 24 hours a day, no human required.' },
              ].map(({ icon, title, desc }) => (
                <div key={title} style={{ display: 'flex', gap: 18, marginBottom: 32 }}>
                  <div style={{ fontSize: 20, flexShrink: 0, marginTop: 2 }}>{icon}</div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', marginBottom: 6, letterSpacing: '0.02em' }}>{title}</div>
                    <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.45)', lineHeight: 1.75 }}>{desc}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* App mockup */}
            <div style={{ borderRadius: 10, overflow: 'hidden', border: '1px solid rgba(201,168,76,0.12)', boxShadow: '0 40px 100px rgba(0,0,0,0.7)' }}>
              <div style={{ background: '#111', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 7 }}>
                {['#ff5f57','#febc2e','#28c840'].map(c => <div key={c} style={{ width: 8, height: 8, borderRadius: '50%', background: c }} />)}
                <div style={{ flex: 1, background: '#1e1e1e', borderRadius: 4, padding: '4px 10px', marginLeft: 6, fontSize: 10, color: '#3a3a3a' }}>propeldialer.com</div>
              </div>
              <div style={{ background: '#fafafa', display: 'flex', height: 360 }}>
                <div style={{ width: 150, background: '#fff', borderRight: '1px solid #f0f0f0', padding: '14px 0', flexShrink: 0 }}>
                  <div style={{ padding: '0 14px 16px', fontFamily: "'Cormorant Garamond', serif", fontSize: 12, fontWeight: 300, letterSpacing: '0.4em', color: GOLD }}>PROPEL</div>
                  {['Dialer','Contacts','AI Agent','Calendar','Analytics'].map((item, i) => (
                    <div key={item} style={{ padding: '8px 14px', fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: i === 0 ? GOLD : '#ccc', background: i === 0 ? 'rgba(201,168,76,0.06)' : 'transparent', borderLeft: i === 0 ? `2px solid ${GOLD}` : '2px solid transparent' }}>
                      {item}
                    </div>
                  ))}
                </div>
                <div style={{ flex: 1, padding: 18, overflow: 'hidden' }}>
                  <div style={{ fontSize: 7.5, fontWeight: 700, letterSpacing: '0.2em', textTransform: 'uppercase', color: '#bbb', marginBottom: 10 }}>Active Session</div>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                    {[['47','Calls Today'],['12','Connected'],['3','Appointments']].map(([v,l]) => (
                      <div key={l} style={{ textAlign: 'center', padding: '8px 10px', background: '#fff', borderRadius: 6, border: '1px solid #eee', flex: 1 }}>
                        <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 22, fontWeight: 300, color: GOLD, lineHeight: 1 }}>{v}</div>
                        <div style={{ fontSize: 7, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#bbb', marginTop: 2 }}>{l}</div>
                      </div>
                    ))}
                  </div>
                  {[
                    ['Margaret Thornton','Expired Listing','hot'],
                    ['James Whitfield','FSBO','contacted'],
                    ['Sarah Chen','Circle Prospect','new'],
                    ['Robert Harrington','Expired Listing','callback'],
                  ].map(([name, tag, status]) => (
                    <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '7px 0', borderBottom: '1px solid #f5f5f5' }}>
                      <div style={{ width: 26, height: 26, borderRadius: '50%', background: 'rgba(201,168,76,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontWeight: 700, color: GOLD, flexShrink: 0 }}>
                        {(name as string).split(' ').map((n: string) => n[0]).join('')}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 10.5, fontWeight: 600, color: '#111', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</div>
                        <div style={{ fontSize: 8.5, color: '#aaa' }}>{tag}</div>
                      </div>
                      <div style={{ fontSize: 7.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', padding: '2px 6px', borderRadius: 8, background: status === 'hot' ? 'rgba(201,168,76,0.1)' : status === 'callback' ? 'rgba(59,130,246,0.08)' : '#f5f5f5', color: status === 'hot' ? GOLDDARK : status === 'callback' ? '#3b82f6' : '#aaa', flexShrink: 0 }}>
                        {status}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── SERVICES ─────────────────────────────────────────────────────────── */}
      <section id="services" style={{ padding: '110px 24px', background: '#fff' }}>
        <div style={{ maxWidth: 1060, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 70 }}>
            <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.35em', textTransform: 'uppercase', color: GOLDDARK, marginBottom: 16 }}>What I Offer</div>
            <div className="gold-rule" />
            <h2 className="serif" style={{ fontSize: 'clamp(30px, 4.5vw, 52px)', fontWeight: 300, color: BLACK, lineHeight: 1.1, marginBottom: 16 }}>
              A complete system,<br /><em style={{ fontStyle: 'italic', color: GOLDDARK }}>built once, running forever.</em>
            </h2>
            <p style={{ fontSize: 15, color: GRAY, maxWidth: 520, margin: '0 auto', lineHeight: 1.8 }}>
              Three phases. No surprises. You know exactly what you're getting and what it costs before anything begins.
            </p>
          </div>

          <div className="grid-3" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 18 }}>
            {[
              {
                phase: '01',
                name: 'ROI Map',
                price: 'Complimentary',
                desc: 'A 30-minute working session where I analyze your current lead flow, identify the highest-leverage automation, and map exactly what a system would do for your business — with a projected ROI.',
                items: ['30-minute discovery call', 'Custom automation blueprint', 'Projected ROI breakdown', 'No obligation, no pitch deck'],
                cta: 'Start Here',
              },
              {
                phase: '02',
                name: 'Custom Build',
                price: '$2,500 – $7,500',
                desc: 'I build your system from the ground up — dialer, AI agent, follow-up sequences, integrations. Everything configured for your market, your leads, your workflow.',
                items: ['Full system build & deployment', 'Twilio & AI setup in your accounts', 'Data migration & onboarding', '30-day post-launch support'],
                cta: 'Get a Quote',
                highlight: true,
              },
              {
                phase: '03',
                name: 'Monthly Retainer',
                price: '$500 – $1,500 / mo',
                desc: 'Hosting, monitoring, prompt tuning, updates. Your system keeps running and improving month after month while you focus on closing deals.',
                items: ['Managed hosting & uptime', 'AI prompt optimization', 'Feature updates & improvements', 'Priority support'],
                cta: 'Learn More',
              },
            ].map(({ phase, name, price, desc, items, cta, highlight }) => (
              <div key={name} className="service-card" style={{
                background: highlight ? BLACK : '#fff',
                border: highlight ? '1px solid rgba(201,168,76,0.25)' : '1px solid rgba(0,0,0,0.08)',
                boxShadow: highlight ? '0 28px 72px rgba(0,0,0,0.18)' : undefined,
                position: 'relative',
              }}>
                {highlight && (
                  <div style={{ position: 'absolute', top: -11, left: '50%', transform: 'translateX(-50%)', background: GOLD, color: '#fff', fontSize: 8.5, fontWeight: 700, letterSpacing: '0.2em', textTransform: 'uppercase', padding: '3px 14px', borderRadius: 20 }}>
                    Most Popular
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
                  <div className="serif" style={{ fontSize: 42, fontWeight: 300, color: highlight ? 'rgba(201,168,76,0.2)' : 'rgba(0,0,0,0.07)', lineHeight: 1 }}>{phase}</div>
                  <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: GOLD }}>{name}</div>
                </div>
                <div className="serif" style={{ fontSize: 26, fontWeight: 300, color: highlight ? '#fff' : BLACK, marginBottom: 12, lineHeight: 1.2 }}>{price}</div>
                <p style={{ fontSize: 13, color: highlight ? 'rgba(255,255,255,0.5)' : GRAY, lineHeight: 1.75, marginBottom: 24 }}>{desc}</p>
                <div style={{ marginBottom: 28 }}>
                  {items.map(item => (
                    <div key={item} style={{ display: 'flex', gap: 10, marginBottom: 9, alignItems: 'flex-start' }}>
                      <span style={{ color: GOLD, fontSize: 10, marginTop: 3, flexShrink: 0 }}>✓</span>
                      <span style={{ fontSize: 12.5, color: highlight ? 'rgba(255,255,255,0.55)' : GRAY, lineHeight: 1.6 }}>{item}</span>
                    </div>
                  ))}
                </div>
                <button onClick={() => scrollTo('contact')} style={{
                  width: '100%', padding: '12px', borderRadius: 4, cursor: 'pointer',
                  background: highlight ? GOLD : 'transparent',
                  color: highlight ? '#fff' : BLACK,
                  border: highlight ? 'none' : '1.5px solid rgba(0,0,0,0.12)',
                  fontSize: 10.5, fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase',
                  transition: 'opacity 0.2s',
                }}
                  onMouseEnter={e => (e.currentTarget.style.opacity = '0.8')}
                  onMouseLeave={e => (e.currentTarget.style.opacity = '1')}>
                  {cta}
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── WHO IT'S FOR ─────────────────────────────────────────────────────── */}
      <section style={{ padding: '110px 24px', background: '#fafaf8' }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <div className="grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 80, alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.35em', textTransform: 'uppercase', color: GOLDDARK, marginBottom: 16 }}>Who This Is For</div>
              <div className="gold-rule-left" />
              <h2 className="serif" style={{ fontSize: 'clamp(28px, 3.5vw, 44px)', fontWeight: 300, color: BLACK, lineHeight: 1.15, marginBottom: 20 }}>
                Real estate agents who are{' '}
                <em style={{ fontStyle: 'italic', color: GOLDDARK }}>serious about growth.</em>
              </h2>
              <p style={{ fontSize: 14.5, color: GRAY, lineHeight: 1.85, marginBottom: 0 }}>
                Not for everyone. I work with agents who have a real lead flow and want to systematize 
                their follow-up — not agents looking for a magic button that replaces doing the work.
              </p>
            </div>
            <div>
              {[
                { yes: true,  text: 'You work expired listings, FSBOs, or circle prospecting' },
                { yes: true,  text: 'You make or want to make 50+ calls per day' },
                { yes: true,  text: 'You\'re losing deals because follow-up falls through the cracks' },
                { yes: true,  text: 'You want a competitive edge that most agents don\'t have' },
                { yes: false, text: 'You\'re looking for a one-size-fits-all app' },
                { yes: false, text: 'You want results without any involvement' },
              ].map(({ yes, text }) => (
                <div key={text} style={{ display: 'flex', gap: 14, marginBottom: 16, alignItems: 'flex-start' }}>
                  <div style={{
                    width: 22, height: 22, borderRadius: '50%', flexShrink: 0, marginTop: 1,
                    background: yes ? 'rgba(201,168,76,0.12)' : 'rgba(0,0,0,0.05)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 10, color: yes ? GOLDDARK : '#ccc', fontWeight: 700,
                  }}>
                    {yes ? '✓' : '✕'}
                  </div>
                  <span style={{ fontSize: 13.5, color: yes ? '#374151' : '#bbb', lineHeight: 1.65 }}>{text}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ─────────────────────────────────────────────────────── */}
      <section style={{ padding: '110px 24px', background: '#fff' }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 70 }}>
            <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.35em', textTransform: 'uppercase', color: GOLDDARK, marginBottom: 16 }}>The Process</div>
            <div className="gold-rule" />
            <h2 className="serif" style={{ fontSize: 'clamp(28px, 4vw, 46px)', fontWeight: 300, color: BLACK }}>
              From first call to <em style={{ fontStyle: 'italic', color: GOLDDARK }}>live system</em> in weeks, not months.
            </h2>
          </div>

          <div className="process-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 40 }}>
            {[
              { n: '01', title: 'Discovery', desc: 'We map your workflow, lead sources, and biggest time drains in a single call.' },
              { n: '02', title: 'Blueprint', desc: 'I design the exact system — every component, integration, and automation — before writing a line of code.' },
              { n: '03', title: 'Build', desc: 'I build, test, and deploy your system. You see it working before anything is finalized.' },
              { n: '04', title: 'Launch & Grow', desc: 'Your system goes live. I monitor, tune, and improve it every month on retainer.' },
            ].map(({ n, title, desc }, i) => (
              <div key={n} style={{ textAlign: 'center', position: 'relative' }}>
                {i < 3 && <div style={{ position: 'absolute', top: 20, left: '60%', right: '-40%', height: 1, background: 'rgba(201,168,76,0.18)' }} />}
                <div className="serif" style={{ fontSize: 44, fontWeight: 300, color: 'rgba(201,168,76,0.18)', lineHeight: 1, marginBottom: 18 }}>{n}</div>
                <h3 style={{ fontSize: 12, fontWeight: 700, color: BLACK, marginBottom: 10, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{title}</h3>
                <p style={{ fontSize: 12.5, color: GRAY, lineHeight: 1.75, margin: 0 }}>{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CONTACT FORM ─────────────────────────────────────────────────────── */}
      <section id="contact" ref={contactRef} style={{ padding: '110px 24px', background: BLACK, position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: 0, right: 0, width: 400, height: 400, borderRadius: '50%', background: 'rgba(201,168,76,0.03)', transform: 'translate(30%, -30%)' }} />
        <div style={{ maxWidth: 620, margin: '0 auto', position: 'relative', zIndex: 1 }}>
          <div style={{ textAlign: 'center', marginBottom: 52 }}>
            <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.35em', textTransform: 'uppercase', color: GOLD, marginBottom: 16 }}>Get in Touch</div>
            <div className="gold-rule" />
            <h2 className="serif" style={{ fontSize: 'clamp(30px, 4.5vw, 52px)', fontWeight: 300, color: '#fff', lineHeight: 1.1, marginBottom: 18 }}>
              Let's talk about<br /><em style={{ fontStyle: 'italic', color: GOLD }}>what's possible.</em>
            </h2>
            <p style={{ fontSize: 14.5, color: 'rgba(255,255,255,0.45)', lineHeight: 1.8 }}>
              Tell me a bit about your business. I'll follow up within one business day.
            </p>
          </div>

          {formSent ? (
            <div style={{ textAlign: 'center', padding: '52px 32px', background: 'rgba(255,255,255,0.04)', borderRadius: 12, border: '1px solid rgba(201,168,76,0.2)' }}>
              <div style={{ fontSize: 32, marginBottom: 16 }}>✓</div>
              <h3 className="serif" style={{ fontSize: 28, fontWeight: 300, color: '#fff', marginBottom: 12 }}>Message sent.</h3>
              <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.45)', lineHeight: 1.7 }}>
                Your email client opened with your message. Send it and I'll be in touch within one business day.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              <div className="grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)', marginBottom: 8 }}>
                    Full Name *
                  </label>
                  <input required className="form-input" type="text" placeholder="Jane Smith"
                    value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)', marginBottom: 8 }}>
                    Email *
                  </label>
                  <input required className="form-input" type="email" placeholder="jane@realty.com"
                    value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
                </div>
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)', marginBottom: 8 }}>
                  Your Role / Business
                </label>
                <input className="form-input" type="text" placeholder="Real estate agent, Baltimore MD"
                  value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))} />
              </div>
              <div style={{ marginBottom: 28 }}>
                <label style={{ display: 'block', fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)', marginBottom: 8 }}>
                  Tell me about your situation
                </label>
                <textarea required className="form-input" rows={5}
                  placeholder="How many leads are you working? What's falling through the cracks? What would it mean to have automated follow-up running 24/7?"
                  value={form.message} onChange={e => setForm(f => ({ ...f, message: e.target.value }))}
                  style={{ resize: 'vertical', minHeight: 130 }} />
              </div>
              <button type="submit" disabled={formLoading} style={{
                ...btnGold,
                width: '100%', justifyContent: 'center', padding: '16px',
                opacity: formLoading ? 0.7 : 1,
              }}
                onMouseEnter={e => { if (!formLoading) (e.currentTarget as HTMLElement).style.background = GOLDDARK; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = GOLD; }}>
                {formLoading ? 'Opening your email…' : 'Send Message →'}
              </button>
              <p style={{ textAlign: 'center', marginTop: 16, fontSize: 11, color: 'rgba(255,255,255,0.2)', letterSpacing: '0.05em' }}>
                I respond to every inquiry within one business day.
              </p>
            </form>
          )}
        </div>
      </section>

      {/* ── FOOTER ───────────────────────────────────────────────────────────── */}
      <footer style={{ background: '#030303', padding: '28px 48px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 14, borderTop: '1px solid rgba(201,168,76,0.07)' }}>
        <span className="serif" style={{ fontSize: 16, fontWeight: 300, letterSpacing: '0.5em', color: '#252525' }}>PROPEL</span>
        <div style={{ fontSize: 10.5, color: '#252525', letterSpacing: '0.05em' }}>© 2026 Propel · All rights reserved</div>
        <button onClick={onSignIn} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 9.5, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#333' }}
          onMouseEnter={e => (e.currentTarget.style.color = GOLD)}
          onMouseLeave={e => (e.currentTarget.style.color = '#333')}>
          Client Login →
        </button>
      </footer>
    </div>
  );
}
