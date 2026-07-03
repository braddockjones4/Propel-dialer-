import React, { useState, useEffect } from 'react';

interface Props { onSignIn: () => void }

const GOLD     = '#C9A84C';
const GOLDDARK = '#9A7A2E';
const BLACK    = '#0A0A0A';
const GRAY     = '#6B7280';

interface FormState { name: string; email: string; role: string; message: string }

export default function Landing({ onSignIn }: Props) {
  const [scrolled, setScrolled]     = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [form, setForm]             = useState<FormState>({ name: '', email: '', role: '', message: '' });
  const [formSent, setFormSent]     = useState(false);
  const [formLoading, setFormLoading] = useState(false);

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
    const subject = encodeURIComponent(`Inquiry from ${form.name} — ${form.role}`);
    const body    = encodeURIComponent(`Name: ${form.name}\nEmail: ${form.email}\nRole: ${form.role}\n\n${form.message}`);
    window.open(`mailto:Braddockjones4@icloud.com?subject=${subject}&body=${body}`);
    setTimeout(() => { setFormLoading(false); setFormSent(true); }, 600);
  };

  return (
    <div style={{ fontFamily: "'Inter', sans-serif", background: '#fff', color: BLACK, lineHeight: 1.6, WebkitFontSmoothing: 'antialiased' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300&family=Inter:wght@300;400;500;600&display=swap');
        .serif { font-family: 'Cormorant Garamond', serif !important; }
        .nav-lnk { font-size: 10px; font-weight: 600; letter-spacing: 0.18em; text-transform: uppercase; background: none; border: none; cursor: pointer; transition: color 0.2s; padding: 0; }
        .f-input { width: 100%; padding: 12px 14px; border: 1.5px solid rgba(0,0,0,0.09); border-radius: 6px; font-size: 13px; font-family: inherit; color: #111; background: #fafafa; outline: none; transition: border-color 0.2s; box-sizing: border-box; }
        .f-input:focus { border-color: ${GOLD}; background: #fff; }
        .f-input::placeholder { color: #bbb; }
        @media (max-width: 640px) {
          .hero-title { font-size: 48px !important; }
          .grid-2 { grid-template-columns: 1fr !important; }
          .grid-3 { grid-template-columns: 1fr !important; }
          .nav-desktop { display: none !important; }
          .nav-burger  { display: block !important; }
        }
      `}</style>

      {/* ── NAV ─────────────────────────────────────────────────────────────── */}
      <nav style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 200,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 48px', height: 60,
        background: scrolled ? 'rgba(255,255,255,0.97)' : 'transparent',
        backdropFilter: scrolled ? 'blur(16px)' : 'none',
        borderBottom: scrolled ? '1px solid rgba(201,168,76,0.12)' : 'none',
        transition: 'all 0.3s',
      }}>
        <span className="serif" style={{ fontSize: 17, fontWeight: 300, letterSpacing: '0.55em', color: scrolled ? BLACK : '#fff' }}>PROPEL</span>

        <div className="nav-desktop" style={{ display: 'flex', alignItems: 'center', gap: 36 }}>
          {['Work', 'Services', 'Contact'].map(label => (
            <button key={label} className="nav-lnk"
              onClick={() => scrollTo(label.toLowerCase())}
              style={{ color: scrolled ? GRAY : 'rgba(255,255,255,0.6)' }}
              onMouseEnter={e => (e.currentTarget.style.color = scrolled ? BLACK : '#fff')}
              onMouseLeave={e => (e.currentTarget.style.color = scrolled ? GRAY : 'rgba(255,255,255,0.6)')}>
              {label}
            </button>
          ))}
          <button onClick={onSignIn} style={{
            fontSize: 10, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase',
            padding: '6px 16px', borderRadius: 4,
            border: `1px solid ${scrolled ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.25)'}`,
            background: 'transparent', color: scrolled ? GRAY : 'rgba(255,255,255,0.6)',
            cursor: 'pointer', transition: 'all 0.2s',
          }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = GOLD; e.currentTarget.style.color = GOLD; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = scrolled ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.25)'; e.currentTarget.style.color = scrolled ? GRAY : 'rgba(255,255,255,0.6)'; }}>
            Client Login
          </button>
        </div>

        <button className="nav-burger" onClick={() => setMobileOpen(o => !o)}
          style={{ display: 'none', background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: scrolled ? BLACK : '#fff' }}>
          {mobileOpen ? '✕' : '☰'}
        </button>
      </nav>

      {mobileOpen && (
        <div style={{ position: 'fixed', top: 60, left: 0, right: 0, zIndex: 199, background: '#fff', borderBottom: '1px solid #f0f0f0', padding: '6px 0 14px' }}>
          {['Work', 'Services', 'Contact'].map(label => (
            <button key={label} onClick={() => scrollTo(label.toLowerCase())}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '12px 28px', background: 'none', border: 'none', fontSize: 11, fontWeight: 600, letterSpacing: '0.15em', textTransform: 'uppercase', color: GRAY, cursor: 'pointer' }}>
              {label}
            </button>
          ))}
          <div style={{ padding: '8px 28px 0', display: 'flex', gap: 10 }}>
            <button onClick={() => scrollTo('contact')} style={{ flex: 1, padding: '11px', borderRadius: 4, border: 'none', background: GOLD, color: '#fff', fontSize: 10, fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', cursor: 'pointer' }}>Get in Touch</button>
            <button onClick={onSignIn} style={{ padding: '11px 16px', borderRadius: 4, border: '1px solid rgba(0,0,0,0.1)', background: 'transparent', fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: GRAY, cursor: 'pointer' }}>Login</button>
          </div>
        </div>
      )}

      {/* ── HERO ────────────────────────────────────────────────────────────── */}
      <section style={{ position: 'relative', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: BLACK, overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: 0 }}>
          <img src="https://images.unsplash.com/photo-1560518883-ce09059eeffa?auto=format&fit=crop&w=1600&q=80" alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center', opacity: 0.35 }} />
        </div>
        <div style={{ position: 'relative', zIndex: 1, textAlign: 'center', padding: '140px 24px 120px', maxWidth: 700, margin: '0 auto' }}>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.4em', textTransform: 'uppercase', color: GOLD, marginBottom: 32 }}>
            AI Automation · Built to Order
          </div>
          <h1 className="hero-title serif" style={{ fontSize: 'clamp(52px, 8vw, 96px)', fontWeight: 300, lineHeight: 1.0, letterSpacing: '0.01em', color: '#fff', margin: '0 0 40px' }}>
            Custom AI systems<br />for your business.
          </h1>
          <p style={{ fontSize: 16, fontWeight: 300, color: 'rgba(255,255,255,0.55)', maxWidth: 400, margin: '0 auto 52px', lineHeight: 1.8 }}>
            I design and build AI agents tailored to how you work — not off-the-shelf software.
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button onClick={() => scrollTo('contact')} style={{ padding: '14px 36px', background: GOLD, color: '#fff', border: 'none', borderRadius: 3, fontSize: 10, fontWeight: 700, letterSpacing: '0.2em', textTransform: 'uppercase', cursor: 'pointer' }}
              onMouseEnter={e => (e.currentTarget.style.background = GOLDDARK)}
              onMouseLeave={e => (e.currentTarget.style.background = GOLD)}>
              Get in Touch
            </button>
            <button onClick={() => scrollTo('work')} style={{ padding: '14px 36px', background: 'transparent', color: 'rgba(255,255,255,0.7)', border: '1px solid rgba(255,255,255,0.25)', borderRadius: 3, fontSize: 10, fontWeight: 600, letterSpacing: '0.2em', textTransform: 'uppercase', cursor: 'pointer' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.06)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
              See the Work
            </button>
          </div>
        </div>
      </section>

      {/* ── WORK / PROOF ────────────────────────────────────────────────────── */}
      <section id="work" style={{ padding: '100px 24px', background: '#fafaf8' }}>
        <div style={{ maxWidth: 1000, margin: '0 auto' }}>
          <div style={{ marginBottom: 56 }}>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.4em', textTransform: 'uppercase', color: GOLD, marginBottom: 14 }}>Live Work</div>
            <h2 className="serif" style={{ fontSize: 'clamp(28px, 4vw, 46px)', fontWeight: 300, color: BLACK, margin: '0 0 16px', lineHeight: 1.1 }}>
              Propel — AI Dialing System<br /><em style={{ fontStyle: 'italic', color: GOLDDARK }}>for Real Estate</em>
            </h2>
            <p style={{ fontSize: 14, color: GRAY, maxWidth: 480, lineHeight: 1.85, margin: 0 }}>
              A fully operational system built for a real estate agent — triple-line power dialing, AI-generated scripts, automated SMS follow-up, and an autonomous agent that qualifies leads and books appointments around the clock.
            </p>
          </div>

          <div className="grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 48, alignItems: 'start' }}>
            {/* Feature list */}
            <div>
              {[
                { icon: '📞', title: 'Triple-Line Power Dialer',   desc: 'Calls three leads at once. Connects the moment someone picks up. Drops voicemail automatically.' },
                { icon: '🤖', title: 'AI Script Generation',       desc: 'Personalized opener, objection handlers, and close — generated before the dial.' },
                { icon: '💬', title: 'Automated SMS Sequences',    desc: 'Follow-up texts go out automatically after every call, for weeks.' },
                { icon: '🧠', title: '24/7 Autonomous Agent',      desc: 'Responds to inbound texts, qualifies leads, and books appointments overnight.' },
              ].map(({ icon, title, desc }) => (
                <div key={title} style={{ display: 'flex', gap: 16, marginBottom: 28 }}>
                  <span style={{ fontSize: 18, flexShrink: 0, marginTop: 1 }}>{icon}</span>
                  <div>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: BLACK, marginBottom: 5 }}>{title}</div>
                    <div style={{ fontSize: 12, color: GRAY, lineHeight: 1.7 }}>{desc}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* App mockup */}
            <div style={{ borderRadius: 10, overflow: 'hidden', border: '1px solid rgba(0,0,0,0.08)', boxShadow: '0 24px 64px rgba(0,0,0,0.1)' }}>
              <div style={{ background: '#1a1a1a', padding: '9px 14px', display: 'flex', alignItems: 'center', gap: 6 }}>
                {['#ff5f57','#febc2e','#28c840'].map(c => <div key={c} style={{ width: 8, height: 8, borderRadius: '50%', background: c }} />)}
                <div style={{ flex: 1, background: '#2a2a2a', borderRadius: 3, padding: '3px 10px', marginLeft: 6, fontSize: 9.5, color: '#444' }}>propeldialer.com</div>
              </div>
              <div style={{ background: '#fafafa', display: 'flex', height: 340 }}>
                <div style={{ width: 140, background: '#fff', borderRight: '1px solid #f0f0f0', padding: '12px 0', flexShrink: 0 }}>
                  <div style={{ padding: '0 12px 14px', fontFamily: "'Cormorant Garamond', serif", fontSize: 11, fontWeight: 300, letterSpacing: '0.4em', color: GOLD }}>PROPEL</div>
                  {['Dialer','Contacts','AI Agent','Calendar','Analytics'].map((item, i) => (
                    <div key={item} style={{ padding: '7px 12px', fontSize: 8.5, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: i === 0 ? GOLD : '#ccc', background: i === 0 ? 'rgba(201,168,76,0.05)' : 'transparent', borderLeft: i === 0 ? `2px solid ${GOLD}` : '2px solid transparent' }}>
                      {item}
                    </div>
                  ))}
                </div>
                <div style={{ flex: 1, padding: 16, overflow: 'hidden' }}>
                  <div style={{ fontSize: 7, fontWeight: 700, letterSpacing: '0.2em', textTransform: 'uppercase', color: '#bbb', marginBottom: 10 }}>Active Session</div>
                  <div style={{ display: 'flex', gap: 7, marginBottom: 14 }}>
                    {[['47','Calls'],['12','Connected'],['3','Booked']].map(([v,l]) => (
                      <div key={l} style={{ textAlign: 'center', padding: '7px 8px', background: '#fff', borderRadius: 6, border: '1px solid #eee', flex: 1 }}>
                        <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 20, fontWeight: 300, color: GOLD, lineHeight: 1 }}>{v}</div>
                        <div style={{ fontSize: 6.5, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#bbb', marginTop: 2 }}>{l}</div>
                      </div>
                    ))}
                  </div>
                  {[
                    ['Margaret Thornton','Expired Listing','hot'],
                    ['James Whitfield','FSBO','contacted'],
                    ['Sarah Chen','Circle Prospect','new'],
                    ['Robert Harrington','Expired Listing','callback'],
                  ].map(([name, tag, status]) => (
                    <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid #f5f5f5' }}>
                      <div style={{ width: 24, height: 24, borderRadius: '50%', background: 'rgba(201,168,76,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 7.5, fontWeight: 700, color: GOLD, flexShrink: 0 }}>
                        {(name as string).split(' ').map((n:string) => n[0]).join('')}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 10, fontWeight: 600, color: '#111', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</div>
                        <div style={{ fontSize: 8, color: '#bbb' }}>{tag}</div>
                      </div>
                      <div style={{ fontSize: 7, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '2px 6px', borderRadius: 8, background: status === 'hot' ? 'rgba(201,168,76,0.1)' : '#f5f5f5', color: status === 'hot' ? GOLDDARK : '#bbb', flexShrink: 0 }}>
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

      {/* ── SERVICES ────────────────────────────────────────────────────────── */}
      <section id="services" style={{ padding: '100px 24px', background: BLACK }}>
        <div style={{ maxWidth: 1000, margin: '0 auto' }}>
          <div style={{ marginBottom: 56, maxWidth: 480 }}>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.4em', textTransform: 'uppercase', color: GOLD, marginBottom: 14 }}>Services</div>
            <h2 className="serif" style={{ fontSize: 'clamp(28px, 4vw, 46px)', fontWeight: 300, color: '#fff', lineHeight: 1.1, margin: 0 }}>
              Three phases.<br />No surprises.
            </h2>
          </div>

          <div className="grid-3" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1, background: 'rgba(255,255,255,0.06)', borderRadius: 10, overflow: 'hidden' }}>
            {[
              { phase: '01', name: 'ROI Map', price: 'Complimentary', desc: 'A 30-minute call to map your workflow, identify the highest-leverage automation, and estimate ROI before anything begins.' },
              { phase: '02', name: 'Custom Build', price: '$2,500 – $7,500', desc: 'Full system build and deployment — configured for your market, your workflow, your accounts. 30 days of post-launch support included.', highlight: true },
              { phase: '03', name: 'Monthly Retainer', price: '$500 – $1,500 / mo', desc: 'Hosting, monitoring, tuning, and updates. Your system keeps running and improving.' },
            ].map(({ phase, name, price, desc, highlight }) => (
              <div key={name} style={{ padding: '40px 32px', background: highlight ? 'rgba(201,168,76,0.07)' : BLACK, position: 'relative' }}>
                {highlight && <div style={{ position: 'absolute', top: 16, right: 20, fontSize: 8, fontWeight: 700, letterSpacing: '0.2em', textTransform: 'uppercase', color: GOLD }}>Most common</div>}
                <div className="serif" style={{ fontSize: 36, fontWeight: 300, color: 'rgba(201,168,76,0.12)', lineHeight: 1, marginBottom: 16 }}>{phase}</div>
                <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: GOLD, marginBottom: 8 }}>{name}</div>
                <div className="serif" style={{ fontSize: 22, fontWeight: 300, color: '#fff', marginBottom: 16, lineHeight: 1.2 }}>{price}</div>
                <p style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.4)', lineHeight: 1.75, margin: '0 0 28px' }}>{desc}</p>
                <button onClick={() => scrollTo('contact')} style={{ padding: '10px 22px', borderRadius: 3, border: `1px solid ${highlight ? GOLD : 'rgba(255,255,255,0.12)'}`, background: 'transparent', color: highlight ? GOLD : 'rgba(255,255,255,0.35)', fontSize: 9.5, fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', cursor: 'pointer' }}>
                  Start Here
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CONTACT ─────────────────────────────────────────────────────────── */}
      <section id="contact" style={{ padding: '100px 24px', background: '#fafaf8' }}>
        <div style={{ maxWidth: 560, margin: '0 auto' }}>
          <div style={{ marginBottom: 48 }}>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.4em', textTransform: 'uppercase', color: GOLD, marginBottom: 14 }}>Contact</div>
            <h2 className="serif" style={{ fontSize: 'clamp(28px, 4vw, 46px)', fontWeight: 300, color: BLACK, lineHeight: 1.1, margin: '0 0 14px' }}>
              Let's talk.
            </h2>
            <p style={{ fontSize: 14, color: GRAY, lineHeight: 1.8, margin: 0 }}>
              Tell me about your business and what you're trying to automate. I'll follow up within one business day.
            </p>
          </div>

          {formSent ? (
            <div style={{ textAlign: 'center', padding: '48px 32px', background: '#fff', borderRadius: 10, border: '1px solid rgba(0,0,0,0.06)' }}>
              <div style={{ fontSize: 28, marginBottom: 14, color: GOLD }}>✓</div>
              <div className="serif" style={{ fontSize: 24, fontWeight: 300, color: BLACK, marginBottom: 8 }}>Message sent.</div>
              <p style={{ fontSize: 13, color: GRAY, lineHeight: 1.7, margin: 0 }}>Your email client opened with the message. I'll be in touch shortly.</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#9ca3af', marginBottom: 7 }}>Name *</label>
                  <input required className="f-input" type="text" placeholder="Jane Smith"
                    value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#9ca3af', marginBottom: 7 }}>Email *</label>
                  <input required className="f-input" type="email" placeholder="jane@example.com"
                    value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
                </div>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#9ca3af', marginBottom: 7 }}>Your Business</label>
                <input className="f-input" type="text" placeholder="Real estate agent, contractor, etc."
                  value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#9ca3af', marginBottom: 7 }}>Message *</label>
                <textarea required className="f-input" rows={5} placeholder="What are you trying to automate?"
                  value={form.message} onChange={e => setForm(f => ({ ...f, message: e.target.value }))}
                  style={{ resize: 'vertical', minHeight: 120 }} />
              </div>
              <button type="submit" disabled={formLoading} style={{ padding: '14px', background: GOLD, color: '#fff', border: 'none', borderRadius: 4, fontSize: 10.5, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', cursor: 'pointer', opacity: formLoading ? 0.7 : 1 }}
                onMouseEnter={e => { if (!formLoading) (e.currentTarget as HTMLElement).style.background = GOLDDARK; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = GOLD; }}>
                {formLoading ? 'Opening your email…' : 'Send Message →'}
              </button>
            </form>
          )}
        </div>
      </section>

      {/* ── FOOTER ──────────────────────────────────────────────────────────── */}
      <footer style={{ background: '#050505', padding: '24px 48px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, borderTop: '1px solid rgba(201,168,76,0.06)' }}>
        <span className="serif" style={{ fontSize: 15, fontWeight: 300, letterSpacing: '0.5em', color: '#222' }}>PROPEL</span>
        <div style={{ fontSize: 10, color: '#222', letterSpacing: '0.04em' }}>© 2026</div>
        <button onClick={onSignIn} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 9, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#333' }}
          onMouseEnter={e => (e.currentTarget.style.color = GOLD)}
          onMouseLeave={e => (e.currentTarget.style.color = '#333')}>
          Client Login →
        </button>
      </footer>
    </div>
  );
}
