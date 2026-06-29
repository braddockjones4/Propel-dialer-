import React, { useState, useEffect, useRef } from 'react';

interface Props {
  onSignIn: () => void;
}

const GOLD     = '#C9A84C';
const GOLDDARK = '#9A7A2E';
const BLACK    = '#0A0A0A';
const GRAY     = '#6B7280';

const btnGold: React.CSSProperties = {
  display: 'inline-block', padding: '14px 38px',
  background: GOLD, color: '#fff', border: 'none', borderRadius: 3,
  fontSize: 11, fontWeight: 700, letterSpacing: '0.2em', textTransform: 'uppercase',
  cursor: 'pointer', transition: 'all 0.25s',
};
const btnOutline: React.CSSProperties = {
  display: 'inline-block', padding: '14px 38px',
  background: 'transparent', color: '#fff', border: '1px solid rgba(255,255,255,0.4)', borderRadius: 3,
  fontSize: 11, fontWeight: 600, letterSpacing: '0.2em', textTransform: 'uppercase',
  cursor: 'pointer', transition: 'all 0.25s',
};

const MARQUEE_PHOTOS = [
  'https://images.unsplash.com/photo-1762979790868-3bf9153b84cc?auto=format&fit=crop&w=600&h=380&q=80',
  'https://images.unsplash.com/photo-1778602206000-c213ed55aab4?auto=format&fit=crop&w=600&h=380&q=80',
  'https://images.unsplash.com/photo-1585695123965-b99e505a8610?auto=format&fit=crop&w=600&h=380&q=80',
  'https://images.unsplash.com/photo-1778603346141-a73bd5c0209f?auto=format&fit=crop&w=600&h=380&q=80',
  'https://images.unsplash.com/photo-1762527645131-5ab809327115?auto=format&fit=crop&w=600&h=380&q=80',
  'https://images.unsplash.com/photo-1632748750121-44a41698ca8a?auto=format&fit=crop&w=600&h=380&q=80',
  'https://images.unsplash.com/photo-1604922422515-703ff9cadd48?auto=format&fit=crop&w=600&h=380&q=80',
];

function MarqueeStrip() {
  const doubled = [...MARQUEE_PHOTOS, ...MARQUEE_PHOTOS];
  return (
    <div style={{ overflow: 'hidden', background: BLACK, padding: '40px 0' }}>
      <style>{`
        @keyframes marquee { from { transform: translateX(0); } to { transform: translateX(-50%); } }
        .mq { display: flex; gap: 16px; width: max-content; animation: marquee 36s linear infinite; }
        .mq:hover { animation-play-state: paused; }
      `}</style>
      <div className="mq">
        {doubled.map((src, i) => (
          <div key={i} style={{ width: 300, height: 200, borderRadius: 6, overflow: 'hidden', flexShrink: 0 }}>
            <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Landing({ onSignIn }: Props) {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const heroRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 40);
    window.addEventListener('scroll', fn);
    return () => window.removeEventListener('scroll', fn);
  }, []);

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
    setMobileOpen(false);
  };

  return (
    <div style={{ fontFamily: "'Inter', sans-serif", background: '#fff', color: BLACK, lineHeight: 1.6, WebkitFontSmoothing: 'antialiased' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300;1,400&family=Inter:wght@300;400;500;600&display=swap');
        .serif { font-family: 'Cormorant Garamond', serif !important; }
        .nav-lnk { font-size: 11px; font-weight: 500; letter-spacing: 0.15em; text-transform: uppercase; background: none; border: none; cursor: pointer; transition: color 0.2s; padding: 0; }
        .feat-card { background: #fff; border: 1px solid rgba(201,168,76,0.12); border-radius: 10px; padding: 32px 28px; transition: transform 0.2s, box-shadow 0.2s, border-color 0.2s; }
        .feat-card:hover { transform: translateY(-4px); box-shadow: 0 16px 48px rgba(0,0,0,0.07); border-color: rgba(201,168,76,0.3); }
        .price-card { transition: transform 0.2s, box-shadow 0.2s; }
        .price-card:hover { transform: translateY(-5px); box-shadow: 0 20px 60px rgba(0,0,0,0.12); }
        .gold-rule { width: 40px; height: 1px; background: #C9A84C; margin: 0 auto 20px; }
        @media (max-width: 640px) {
          .hero-h1 { font-size: 52px !important; }
          .feat-grid { grid-template-columns: 1fr !important; }
          .how-grid  { grid-template-columns: 1fr 1fr !important; }
          .price-grid { grid-template-columns: 1fr !important; }
          .split-grid { grid-template-columns: 1fr !important; }
          .nav-desktop { display: none !important; }
          .nav-burger { display: block !important; }
        }
        @media (max-width: 900px) {
          .how-grid { grid-template-columns: repeat(2,1fr) !important; }
        }
      `}</style>

      {/* ── NAV ── */}
      <nav style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 200,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 48px', height: 60,
        background: scrolled ? 'rgba(255,255,255,0.97)' : 'transparent',
        backdropFilter: scrolled ? 'blur(16px)' : 'none',
        borderBottom: scrolled ? '1px solid rgba(201,168,76,0.18)' : 'none',
        transition: 'all 0.35s ease',
      }}>
        <span className="serif" style={{ fontSize: 19, fontWeight: 300, letterSpacing: '0.55em', color: scrolled ? BLACK : '#fff' }}>PROPEL</span>

        <div className="nav-desktop" style={{ display: 'flex', alignItems: 'center', gap: 32 }}>
          {['Features', 'How It Works', 'Pricing'].map(label => (
            <button key={label} className="nav-lnk"
              onClick={() => scrollTo(label.toLowerCase().replace(/ /g, '-'))}
              style={{ color: scrolled ? GRAY : 'rgba(255,255,255,0.7)' }}
              onMouseEnter={e => (e.currentTarget.style.color = scrolled ? BLACK : '#fff')}
              onMouseLeave={e => (e.currentTarget.style.color = scrolled ? GRAY : 'rgba(255,255,255,0.7)')}>
              {label}
            </button>
          ))}
          <button onClick={onSignIn} style={{
            ...btnGold, padding: '8px 22px',
            background: scrolled ? BLACK : 'rgba(255,255,255,0.1)',
            border: scrolled ? 'none' : '1px solid rgba(255,255,255,0.35)',
            backdropFilter: 'blur(8px)',
          }}>Sign In</button>
        </div>

        <button className="nav-burger" onClick={() => setMobileOpen(o => !o)}
          style={{ display: 'none', background: 'none', border: 'none', cursor: 'pointer', fontSize: 22, color: scrolled ? BLACK : '#fff' }}>
          {mobileOpen ? '✕' : '☰'}
        </button>
      </nav>

      {mobileOpen && (
        <div style={{ position: 'fixed', top: 60, left: 0, right: 0, zIndex: 199, background: '#fff', borderBottom: '1px solid #f0f0f0', padding: '8px 0 16px' }}>
          {['Features', 'How It Works', 'Pricing'].map(label => (
            <button key={label} onClick={() => scrollTo(label.toLowerCase().replace(/ /g, '-'))}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '12px 24px', background: 'none', border: 'none', fontSize: 12, fontWeight: 500, letterSpacing: '0.12em', textTransform: 'uppercase', color: GRAY, cursor: 'pointer' }}>
              {label}
            </button>
          ))}
          <div style={{ padding: '8px 24px 0' }}>
            <button onClick={onSignIn} style={{ ...btnGold, width: '100%', textAlign: 'center' }}>Sign In</button>
          </div>
        </div>
      )}

      {/* ── HERO ── */}
      <section ref={heroRef} style={{
        position: 'relative', minHeight: '100vh',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        textAlign: 'center', overflow: 'hidden',
        background: '#0A0A0A', /* fallback while image loads */
      }}>
        <div style={{ position: 'absolute', inset: 0, zIndex: 0 }}>
          <img
            src="https://images.unsplash.com/photo-1762979790868-3bf9153b84cc?auto=format&fit=crop&w=1200&q=80"
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 45%', display: 'block' }}
          />
        </div>
        <div style={{ position: 'absolute', inset: 0, zIndex: 1, background: 'linear-gradient(to bottom, rgba(5,5,5,0.6) 0%, rgba(5,5,5,0.45) 50%, rgba(5,5,5,0.7) 100%)' }} />

        <div style={{ position: 'relative', zIndex: 2, padding: '160px 24px 120px', maxWidth: 860, margin: '0 auto' }}>
          <h1 className="hero-h1 serif" style={{
            fontSize: 'clamp(52px, 8vw, 100px)', fontWeight: 300,
            lineHeight: 1.1, letterSpacing: '0.04em', color: '#fff',
            marginBottom: 32, textShadow: '0 2px 40px rgba(0,0,0,0.25)',
          }}>
            Follow up.<br />
            <em style={{ fontStyle: 'italic', color: GOLD }}>Close more.</em>
          </h1>

          <p style={{
            fontSize: 'clamp(15px, 1.8vw, 18px)', fontWeight: 300,
            color: 'rgba(255,255,255,0.88)', maxWidth: 420, margin: '0 auto 48px', lineHeight: 1.9,
            letterSpacing: '0.02em',
          }}>
            Triple-line calling, AI-generated scripts, and instant follow-up — built for real estate agents.
          </p>

          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', justifyContent: 'center' }}>
            <button onClick={onSignIn} style={btnGold}
              onMouseEnter={e => (e.currentTarget.style.background = GOLDDARK)}
              onMouseLeave={e => (e.currentTarget.style.background = GOLD)}>
              Start Free Trial →
            </button>
            <button onClick={() => scrollTo('how-it-works')} style={btnOutline}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
              See How It Works
            </button>
          </div>

          <p style={{ marginTop: 20, fontSize: 11, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.1em' }}>
            7-day free trial · No credit card required
          </p>
        </div>

        {/* Stats bar */}
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 2,
          display: 'flex', justifyContent: 'center',
          background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(12px)',
          borderTop: '1px solid rgba(201,168,76,0.18)',
        }}>
          {[
            { val: '3×', label: 'More Calls Per Hour' },
            { val: '3 Lines', label: 'Simultaneous Dialing' },
            { val: '< 5 min', label: 'Setup Time' },
          ].map(({ val, label }, i) => (
            <div key={label} style={{
              flex: 1, maxWidth: 240, textAlign: 'center', padding: '22px 20px',
              borderLeft: i > 0 ? '1px solid rgba(255,255,255,0.07)' : 'none',
            }}>
              <div className="serif" style={{ fontSize: 34, fontWeight: 300, color: GOLD, lineHeight: 1 }}>{val}</div>
              <div style={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)', marginTop: 7 }}>{label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── MARQUEE ── */}
      <MarqueeStrip />

      {/* ── FEATURES ── */}
      <section id="features" style={{ padding: '100px 24px', background: '#fafaf8' }}>
        <div style={{ maxWidth: 1060, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 64 }}>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.35em', textTransform: 'uppercase', color: GOLDDARK, marginBottom: 16 }}>What You Get</div>
            <div className="gold-rule" />
            <h2 className="serif" style={{ fontSize: 'clamp(34px, 5vw, 56px)', fontWeight: 300, color: BLACK, lineHeight: 1.1 }}>
              Everything You Need to<br /><em style={{ fontStyle: 'italic', color: GOLDDARK }}>Win More Business</em>
            </h2>
          </div>

          <div className="feat-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 18 }}>
            {[
              { icon: '📞', title: 'Triple-Line Dialer', desc: 'Call 3 contacts at once. The moment someone picks up, you\'re connected. Skip voicemails automatically.' },
              { icon: '🤖', title: 'AI Call Scripts', desc: 'A personalized opener, objection handlers, and a close — generated for every contact before you dial.' },
              { icon: '📤', title: 'Voicemail Drop', desc: 'Hit a machine? Drop a pre-recorded message in one tap and move on without losing momentum.' },
              { icon: '💬', title: 'SMS & Email Follow-Up', desc: 'Send a personalized text and email the moment you hang up. Follow-up sequences run on autopilot.' },
              { icon: '📋', title: 'Visual Pipeline', desc: 'Drag-and-drop deal tracking. Move contacts from first call to signed listing in one clean view.' },
              { icon: '📊', title: 'Analytics Dashboard', desc: 'See calls made, connect rates, and appointments set. Know what\'s working and double down.' },
            ].map(({ icon, title, desc }) => (
              <div key={title} className="feat-card">
                <div style={{ fontSize: 28, marginBottom: 16 }}>{icon}</div>
                <h3 style={{ fontSize: 15, fontWeight: 700, color: BLACK, marginBottom: 8 }}>{title}</h3>
                <p style={{ fontSize: 13, color: GRAY, lineHeight: 1.7, margin: 0 }}>{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section id="how-it-works" style={{ padding: '100px 24px', background: '#fff' }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 64 }}>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.35em', textTransform: 'uppercase', color: GOLDDARK, marginBottom: 16 }}>Simple Process</div>
            <div className="gold-rule" />
            <h2 className="serif" style={{ fontSize: 'clamp(34px, 5vw, 56px)', fontWeight: 300, color: BLACK }}>
              From Login to <em style={{ fontStyle: 'italic', color: GOLDDARK }}>Listing Appointment</em>
            </h2>
          </div>

          <div className="how-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 36 }}>
            {[
              { n: '01', title: 'Import Leads', desc: 'Upload your list or pull live expired & FSBO data automatically.' },
              { n: '02', title: 'Power Dial', desc: 'Launch a session. Propel dials 3 at once while AI handles your script.' },
              { n: '03', title: 'Follow Up', desc: 'One tap sends a personalized text and email the moment you hang up.' },
              { n: '04', title: 'Close the Deal', desc: 'Book the appointment, update the pipeline, let sequences do the rest.' },
            ].map(({ n, title, desc }, i) => (
              <div key={n} style={{ textAlign: 'center', position: 'relative' }}>
                {i < 3 && <div style={{ position: 'absolute', top: 20, left: '62%', right: '-38%', height: 1, background: 'rgba(201,168,76,0.2)' }} />}
                <div className="serif" style={{ fontSize: 48, fontWeight: 300, color: 'rgba(201,168,76,0.22)', lineHeight: 1, marginBottom: 18 }}>{n}</div>
                <h3 style={{ fontSize: 13, fontWeight: 700, color: BLACK, marginBottom: 8, letterSpacing: '0.05em', textTransform: 'uppercase' }}>{title}</h3>
                <p style={{ fontSize: 12, color: GRAY, lineHeight: 1.7, margin: 0 }}>{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── APP MOCKUP ── */}
      <section style={{ padding: '100px 24px', background: BLACK }}>
        <div style={{ maxWidth: 900, margin: '0 auto', textAlign: 'center' }}>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.35em', textTransform: 'uppercase', color: GOLD, marginBottom: 16 }}>Live Preview</div>
          <div className="gold-rule" />
          <h2 className="serif" style={{ fontSize: 'clamp(30px, 4vw, 48px)', fontWeight: 300, color: '#fff', marginBottom: 48 }}>
            See It In <em style={{ fontStyle: 'italic', color: GOLD }}>Action</em>
          </h2>

          <div style={{ borderRadius: 12, overflow: 'hidden', border: '1px solid rgba(201,168,76,0.15)', boxShadow: '0 48px 120px rgba(0,0,0,0.6)' }}>
            <div style={{ background: '#111', padding: '11px 18px', display: 'flex', alignItems: 'center', gap: 7 }}>
              {['#ff5f57','#febc2e','#28c840'].map(c => <div key={c} style={{ width: 9, height: 9, borderRadius: '50%', background: c }} />)}
              <div style={{ flex: 1, background: '#1e1e1e', borderRadius: 5, padding: '4px 12px', marginLeft: 8, fontSize: 11, color: '#444', textAlign: 'left' }}>propeldialer.com/app</div>
            </div>
            <div style={{ background: '#fff', display: 'flex', height: 340 }}>
              <div style={{ width: 170, background: '#fafafa', borderRight: '1px solid #eee', padding: '14px 0', flexShrink: 0 }}>
                <div style={{ padding: '0 14px 18px', fontFamily: "'Cormorant Garamond', serif", fontSize: 13, fontWeight: 300, letterSpacing: '0.4em', color: GOLD }}>PROPEL</div>
                {['Dialer','Contacts','Pipeline','Calendar','Analytics'].map((item, i) => (
                  <div key={item} style={{ padding: '9px 14px', fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: i === 0 ? GOLD : '#bbb', background: i === 0 ? 'rgba(201,168,76,0.06)' : 'transparent', borderLeft: i === 0 ? `2px solid ${GOLD}` : '2px solid transparent' }}>
                    {item}
                  </div>
                ))}
              </div>
              <div style={{ flex: 1, padding: 24, overflow: 'hidden' }}>
                <div style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.2em', textTransform: 'uppercase', color: '#bbb', marginBottom: 10 }}>Active Session</div>
                <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
                  {[['47','Calls'],['12','Connected'],['3','Appts']].map(([v,l]) => (
                    <div key={l} style={{ textAlign: 'center', padding: '10px 16px', background: '#fafafa', borderRadius: 7, border: '1px solid #eee' }}>
                      <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 26, fontWeight: 300, color: GOLD, lineHeight: 1 }}>{v}</div>
                      <div style={{ fontSize: 8, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#bbb', marginTop: 2 }}>{l}</div>
                    </div>
                  ))}
                </div>
                {[
                  ['Margaret Thornton','(310) 555-0182','Expired','hot'],
                  ['James Whitfield','(424) 555-0337','FSBO','contacted'],
                  ['Sarah Chen','(818) 555-0094','Circle Prospect','new'],
                  ['Robert Harrington','(305) 555-0211','Expired','new'],
                ].map(([name, phone, tag, status]) => (
                  <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid #f5f5f5' }}>
                    <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'rgba(201,168,76,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700, color: GOLD, flexShrink: 0 }}>
                      {(name as string).split(' ').map((n:string) => n[0]).join('')}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: '#111' }}>{name}</div>
                      <div style={{ fontSize: 9, color: '#aaa' }}>{phone} · {tag}</div>
                    </div>
                    <div style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', padding: '2px 7px', borderRadius: 10, background: status === 'hot' ? 'rgba(201,168,76,0.12)' : '#f5f5f5', color: status === 'hot' ? GOLDDARK : '#aaa' }}>
                      {status}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <button onClick={onSignIn} style={{ ...btnGold, marginTop: 40 }}
            onMouseEnter={e => (e.currentTarget.style.background = GOLDDARK)}
            onMouseLeave={e => (e.currentTarget.style.background = GOLD)}>
            Try It Free →
          </button>
        </div>
      </section>

      {/* ── PRICING ── */}
      <section id="pricing" style={{ padding: '100px 24px', background: '#fff' }}>
        <div style={{ maxWidth: 980, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 64 }}>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.35em', textTransform: 'uppercase', color: GOLDDARK, marginBottom: 16 }}>Pricing</div>
            <div className="gold-rule" />
            <h2 className="serif" style={{ fontSize: 'clamp(34px, 5vw, 56px)', fontWeight: 300, color: BLACK }}>
              Plans for Every <em style={{ fontStyle: 'italic', color: GOLDDARK }}>Producer</em>
            </h2>
          </div>

          <div className="price-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20 }}>
            {[
              { name: 'Starter', price: '$99', desc: 'For solo agents getting started', features: ['500 dials/month','AI call scripts','SMS follow-up','Basic pipeline','Email support'], highlight: false },
              { name: 'Pro', price: '$199', desc: 'For serious producers', features: ['Unlimited dials','Triple-line dialer','Voicemail drops','SMS blasts','Analytics dashboard','Priority support'], highlight: true },
              { name: 'Elite', price: '$399', desc: 'For top-producing teams', features: ['Everything in Pro','3 user seats','Team analytics','Priority support'], highlight: false },
            ].map(({ name, price, desc, features, highlight }) => (
              <div key={name} className="price-card" style={{
                padding: '44px 32px', borderRadius: 12,
                background: highlight ? BLACK : '#fff',
                border: `1px solid ${highlight ? 'rgba(201,168,76,0.3)' : 'rgba(201,168,76,0.1)'}`,
                boxShadow: highlight ? '0 28px 72px rgba(0,0,0,0.16)' : '0 2px 20px rgba(0,0,0,0.04)',
                position: 'relative',
              }}>
                {highlight && (
                  <div style={{ position: 'absolute', top: -12, left: '50%', transform: 'translateX(-50%)', background: GOLD, color: '#fff', fontSize: 9, fontWeight: 700, letterSpacing: '0.2em', textTransform: 'uppercase', padding: '4px 16px', borderRadius: 20 }}>
                    Most Popular
                  </div>
                )}
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.25em', textTransform: 'uppercase', color: highlight ? GOLD : GOLDDARK, marginBottom: 10 }}>{name}</div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginBottom: 6 }}>
                  <span className="serif" style={{ fontSize: 50, fontWeight: 300, color: highlight ? '#fff' : BLACK, lineHeight: 1 }}>{price}</span>
                  <span style={{ fontSize: 12, color: highlight ? '#555' : GRAY }}>/mo</span>
                </div>
                <p style={{ fontSize: 12, color: highlight ? '#666' : GRAY, marginBottom: 28 }}>{desc}</p>
                <div style={{ marginBottom: 32 }}>
                  {features.map(f => (
                    <div key={f} style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
                      <span style={{ color: GOLD, fontSize: 11, lineHeight: 1.6 }}>✓</span>
                      <span style={{ fontSize: 13, color: highlight ? '#aaa' : GRAY }}>{f}</span>
                    </div>
                  ))}
                </div>
                <button onClick={onSignIn} style={{
                  width: '100%', padding: '13px', borderRadius: 4, cursor: 'pointer',
                  background: highlight ? GOLD : 'transparent',
                  color: highlight ? '#fff' : BLACK,
                  border: highlight ? 'none' : '1.5px solid rgba(10,10,10,0.15)',
                  fontSize: 11, fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', transition: 'opacity 0.2s',
                }}
                  onMouseEnter={e => (e.currentTarget.style.opacity = '0.8')}
                  onMouseLeave={e => (e.currentTarget.style.opacity = '1')}>
                  Start Free Trial
                </button>
              </div>
            ))}
          </div>

          <p style={{ textAlign: 'center', marginTop: 32, fontSize: 12, color: '#ccc' }}>
            All plans include a 7-day free trial. No credit card required.
          </p>
        </div>
      </section>

      {/* ── CTA ── */}
      <section style={{ position: 'relative', padding: '130px 24px', textAlign: 'center', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: 0, zIndex: 0 }}>
          <img
            src="https://images.unsplash.com/photo-1778603231094-d80e21a66e00?auto=format&fit=crop&w=2000&q=85"
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 50%', display: 'block' }}
          />
        </div>
        <div style={{ position: 'absolute', inset: 0, zIndex: 1, background: 'rgba(5,5,5,0.74)' }} />
        <div style={{ position: 'relative', zIndex: 2, maxWidth: 620, margin: '0 auto' }}>
          <div className="gold-rule" />
          <h2 className="serif" style={{ fontSize: 'clamp(38px, 6vw, 68px)', fontWeight: 300, color: '#fff', marginBottom: 24, lineHeight: 1.05 }}>
            Your Next Listing<br /><em style={{ fontStyle: 'italic', color: GOLD }}>Is One Call Away</em>
          </h2>
          <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.5)', maxWidth: 420, margin: '0 auto 44px', lineHeight: 1.75 }}>
            Triple-line calling, AI scripts, instant follow-up. Everything you need to dial more and close more.
          </p>
          <button onClick={onSignIn} style={{ ...btnGold, fontSize: 12, padding: '16px 52px' }}
            onMouseEnter={e => (e.currentTarget.style.background = GOLDDARK)}
            onMouseLeave={e => (e.currentTarget.style.background = GOLD)}>
            Start Your Free Trial →
          </button>
          <p style={{ marginTop: 20, fontSize: 11, color: 'rgba(255,255,255,0.28)', letterSpacing: '0.1em' }}>7 days free · Cancel anytime</p>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer style={{ background: '#030303', padding: '32px 48px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16, borderTop: '1px solid rgba(201,168,76,0.08)' }}>
        <span className="serif" style={{ fontSize: 17, fontWeight: 300, letterSpacing: '0.5em', color: '#2a2a2a' }}>PROPEL</span>
        <div style={{ fontSize: 11, color: '#2a2a2a', letterSpacing: '0.05em' }}>© 2026 Propel Dialer</div>
        <button onClick={onSignIn} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, fontWeight: 700, letterSpacing: '0.2em', textTransform: 'uppercase', color: GOLD }}>
          Sign In →
        </button>
      </footer>
    </div>
  );
}
