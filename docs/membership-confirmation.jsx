import { useState, useEffect, useRef } from "react";

const BRAND = {
  orange: "#E8652B",
  orangeLight: "#F28C5A",
  orangeDark: "#C4501E",
  orangeGlow: "rgba(232, 101, 43, 0.3)",
  orangeGradient: "linear-gradient(135deg, #F28C5A 0%, #E8652B 50%, #C4501E 100%)",
  successGreen: "#22C55E",
  successGreenGlow: "rgba(34, 197, 94, 0.3)",
  successGradient: "linear-gradient(135deg, #34D399 0%, #22C55E 50%, #16A34A 100%)",
  bg: "#0F1219",
  cardBg: "rgba(255,255,255,0.03)",
  cardBorder: "rgba(255,255,255,0.06)",
};

const TIERS = {
  genesis: {
    name: "Genesis Founder",
    tagline: "You're part of the beginning.",
    accent: "#F59E0B",
    accentGlow: "rgba(245, 158, 11, 0.25)",
    badgeIcon: "⚡",
    perks: ["Private relay access", "NIP-05 verified identity", "Founder badge on profile", "Priority support"],
  },
  cook_plus: {
    name: "Cook+",
    tagline: "Your kitchen just leveled up.",
    accent: "#10B981",
    accentGlow: "rgba(16, 185, 129, 0.25)",
    badgeIcon: "🍳",
    perks: ["Private relay access", "NIP-05 verified identity", "Sous Chef AI assistant", "Ad-free experience"],
  },
  pro_kitchen: {
    name: "Pro Kitchen",
    tagline: "Welcome to the professional tier.",
    accent: "#8B5CF6",
    accentGlow: "rgba(139, 92, 246, 0.25)",
    badgeIcon: "👨‍🍳",
    perks: ["Private relay access", "NIP-05 verified identity", "Full AI suite access", "Priority recipe promotion"],
  },
};

function ConfettiCanvas() {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    canvas.width = canvas.offsetWidth * 2;
    canvas.height = canvas.offsetHeight * 2;
    ctx.scale(2, 2);
    const colors = ["#E8652B", "#F28C5A", "#FBBF24", "#F97316", "#FB923C", "#FCD34D", "#34D399", "#fff"];
    const pieces = Array.from({ length: 55 }, () => ({
      x: Math.random() * canvas.offsetWidth,
      y: Math.random() * canvas.offsetHeight * -1.5,
      w: Math.random() * 8 + 3,
      h: Math.random() * 4 + 2,
      color: colors[Math.floor(Math.random() * colors.length)],
      speed: Math.random() * 1.8 + 0.8,
      spin: Math.random() * 0.1 - 0.05,
      angle: Math.random() * Math.PI * 2,
      drift: Math.random() * 0.8 - 0.4,
      opacity: Math.random() * 0.5 + 0.3,
    }));
    let frame;
    const animate = () => {
      ctx.clearRect(0, 0, canvas.offsetWidth, canvas.offsetHeight);
      pieces.forEach((p) => {
        p.y += p.speed;
        p.x += p.drift;
        p.angle += p.spin;
        if (p.y > canvas.offsetHeight + 20) { p.y = -20; p.x = Math.random() * canvas.offsetWidth; }
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle);
        ctx.globalAlpha = p.opacity;
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      });
      frame = requestAnimationFrame(animate);
    };
    animate();
    return () => cancelAnimationFrame(frame);
  }, []);
  return <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 0 }} />;
}

function UsernameStep({ tier, pubkeyPrefix, onConfirm, onSkip }) {
  const [username, setUsername] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const displayName = username || pubkeyPrefix;
  const hasCustomName = username.length > 0;

  return (
    <div style={{
      background: BRAND.cardBg,
      border: `1px solid ${hasCustomName ? BRAND.orange + "50" : BRAND.cardBorder}`,
      borderRadius: 20, padding: "32px 28px",
      transition: "border-color 0.4s ease, box-shadow 0.4s ease",
      boxShadow: hasCustomName ? `0 0 30px ${BRAND.orangeGlow}` : "none",
    }}>
      <div style={{ textAlign: "center", marginBottom: 28 }}>
        <div style={{
          display: "inline-flex", alignItems: "center", gap: 10,
          background: hasCustomName ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.03)",
          border: `1px solid ${hasCustomName ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.05)"}`,
          borderRadius: 50, padding: "14px 24px",
          transition: "all 0.4s ease",
          transform: hasCustomName ? "scale(1.02)" : "scale(1)",
        }}>
          <div style={{
            width: 26, height: 26, borderRadius: "50%",
            background: hasCustomName ? BRAND.successGreen : "rgba(255,255,255,0.1)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 13, color: "#fff", flexShrink: 0,
            transition: "background 0.4s ease",
            boxShadow: hasCustomName ? `0 0 10px ${BRAND.successGreenGlow}` : "none",
          }}>✓</div>
          <span style={{
            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
            fontSize: 16, color: hasCustomName ? "#fff" : "rgba(255,255,255,0.3)",
            letterSpacing: "-0.02em", transition: "color 0.3s ease",
          }}>
            {displayName}<span style={{ color: "rgba(255,255,255,0.25)" }}>@zap.cooking</span>
          </span>
        </div>
      </div>

      <h3 style={{
        fontFamily: "'Outfit', 'DM Sans', sans-serif",
        fontSize: 19, fontWeight: 600, color: "#fff",
        textAlign: "center", margin: "0 0 6px 0",
      }}>Claim your identity</h3>
      <p style={{
        fontFamily: "'DM Sans', sans-serif",
        fontSize: 14, color: "rgba(255,255,255,0.4)",
        textAlign: "center", margin: "0 0 24px 0", lineHeight: 1.5,
      }}>
        Choose a username for your verified Nostr address.<br />
        This is how other clients will verify you.
      </p>

      <div style={{
        display: "flex", alignItems: "center",
        background: "rgba(0,0,0,0.35)", borderRadius: 14,
        border: `2px solid ${isFocused ? BRAND.orange : "rgba(255,255,255,0.08)"}`,
        padding: "4px 6px 4px 4px",
        transition: "border-color 0.3s ease, box-shadow 0.3s ease",
        boxShadow: isFocused ? `0 0 20px ${BRAND.orangeGlow}` : "none",
      }}>
        <input type="text" placeholder="yourname" value={username}
          onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""))}
          onFocus={() => setIsFocused(true)} onBlur={() => setIsFocused(false)}
          style={{
            flex: 1, background: "transparent", border: "none", outline: "none",
            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
            fontSize: 16, color: "#fff", padding: "12px 14px",
          }}
        />
        <span style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 14, color: "rgba(255,255,255,0.2)",
          paddingRight: 12, whiteSpace: "nowrap",
        }}>@zap.cooking</span>
      </div>

      <div style={{ marginTop: 24, display: "flex", flexDirection: "column", gap: 10 }}>
        <button onClick={() => hasCustomName && onConfirm(username)} style={{
          width: "100%", padding: "15px 24px", borderRadius: 14, border: "none",
          background: hasCustomName ? BRAND.orangeGradient : "rgba(255,255,255,0.05)",
          color: hasCustomName ? "#fff" : "rgba(255,255,255,0.3)",
          fontFamily: "'DM Sans', sans-serif", fontSize: 16, fontWeight: 600,
          cursor: hasCustomName ? "pointer" : "default",
          transition: "all 0.3s ease",
          boxShadow: hasCustomName ? `0 4px 20px ${BRAND.orangeGlow}` : "none",
        }}>
          {hasCustomName ? `Claim ${username}@zap.cooking` : "Type a username above"}
        </button>
        <button onClick={onSkip} style={{
          width: "100%", padding: "12px 24px", borderRadius: 14,
          border: "1px solid rgba(255,255,255,0.05)", background: "transparent",
          color: "rgba(255,255,255,0.25)", fontFamily: "'DM Sans', sans-serif",
          fontSize: 13, cursor: "pointer", transition: "all 0.3s ease",
        }}>
          Skip — use {pubkeyPrefix}@zap.cooking instead
        </button>
      </div>
    </div>
  );
}

export default function MembershipConfirmation() {
  const [showContent, setShowContent] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [chosenName, setChosenName] = useState("");

  const tier = "cook_plus";
  const expirationDate = "February 9, 2027";
  const pubkeyPrefix = "65709f69";
  const config = TIERS[tier];

  useEffect(() => {
    const t = setTimeout(() => setShowContent(true), 200);
    return () => clearTimeout(t);
  }, []);

  return (
    <div style={{
      minHeight: "100vh", background: BRAND.bg,
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: "40px 20px", position: "relative", overflow: "hidden",
    }}>
      <div style={{
        position: "absolute", top: "-30%", left: "50%", transform: "translateX(-50%)",
        width: 800, height: 800, borderRadius: "50%",
        background: `radial-gradient(circle, ${BRAND.orangeGlow} 0%, transparent 70%)`,
        opacity: 0.5, pointerEvents: "none", filter: "blur(80px)",
      }} />
      <ConfettiCanvas />

      <div style={{
        position: "relative", zIndex: 1, width: "100%", maxWidth: 480,
        opacity: showContent ? 1 : 0,
        transform: showContent ? "translateY(0)" : "translateY(20px)",
        transition: "all 0.8s cubic-bezier(0.16, 1, 0.3, 1)",
      }}>
        <div style={{ textAlign: "center", marginBottom: 8 }}>
          <div style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            width: 72, height: 72, borderRadius: 22,
            background: "rgba(255,255,255,0.04)",
            border: `2px solid ${config.accent}35`,
            fontSize: 36, boxShadow: `0 0 40px ${config.accentGlow}`,
          }}>{config.badgeIcon}</div>
        </div>

        <h1 style={{
          fontFamily: "'Playfair Display', 'DM Serif Display', Georgia, serif",
          fontSize: "clamp(28px, 6vw, 40px)", fontWeight: 700, textAlign: "center",
          margin: "20px 0 0 0",
          background: BRAND.orangeGradient,
          WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
          lineHeight: 1.2, letterSpacing: "-0.02em",
        }}>Welcome to {config.name}!</h1>

        <p style={{
          fontFamily: "'DM Sans', sans-serif",
          fontSize: 16, color: "rgba(255,255,255,0.45)",
          textAlign: "center", margin: "10px 0 32px 0",
        }}>{config.tagline}</p>

        <div style={{
          background: BRAND.cardBg, border: `1px solid ${BRAND.cardBorder}`,
          borderRadius: 16, padding: "18px 24px", marginBottom: 20,
          display: "flex", alignItems: "center", justifyContent: "space-between",
          flexWrap: "wrap", gap: 8,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{
              width: 10, height: 10, borderRadius: "50%",
              background: BRAND.successGreen,
              boxShadow: `0 0 8px ${BRAND.successGreenGlow}`,
            }} />
            <span style={{
              fontFamily: "'DM Sans', sans-serif",
              fontSize: 14, color: "rgba(255,255,255,0.55)",
            }}>Membership active</span>
          </div>
          <span style={{
            fontFamily: "'DM Sans', sans-serif",
            fontSize: 14, color: BRAND.orange, fontWeight: 600,
          }}>until {expirationDate}</span>
        </div>

        <div style={{
          background: BRAND.cardBg, border: `1px solid ${BRAND.cardBorder}`,
          borderRadius: 16, padding: "20px 24px", marginBottom: 24,
        }}>
          <p style={{
            fontFamily: "'DM Sans', sans-serif",
            fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.25)",
            textTransform: "uppercase", letterSpacing: "0.08em", margin: "0 0 14px 0",
          }}>What's included</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {config.perks.map((perk, i) => (
              <div key={i} style={{
                display: "flex", alignItems: "center", gap: 10,
                opacity: showContent ? 1 : 0,
                transform: showContent ? "translateX(0)" : "translateX(-10px)",
                transition: `all 0.5s cubic-bezier(0.16, 1, 0.3, 1) ${0.4 + i * 0.1}s`,
              }}>
                <div style={{
                  width: 20, height: 20, borderRadius: 6,
                  background: `${config.accent}18`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 11, color: config.accent, flexShrink: 0,
                }}>✓</div>
                <span style={{
                  fontFamily: "'DM Sans', sans-serif",
                  fontSize: 14, color: "rgba(255,255,255,0.6)",
                }}>{perk}</span>
              </div>
            ))}
          </div>
        </div>

        {!confirmed ? (
          <UsernameStep tier={tier} pubkeyPrefix={pubkeyPrefix}
            onConfirm={(name) => { setChosenName(name); setConfirmed(true); }}
            onSkip={() => { setChosenName(pubkeyPrefix); setConfirmed(true); }}
          />
        ) : (
          <div style={{
            background: "linear-gradient(135deg, rgba(34,197,94,0.06), rgba(34,197,94,0.02))",
            border: "1px solid rgba(34,197,94,0.2)",
            borderRadius: 20, padding: "32px 28px", textAlign: "center",
          }}>
            <div style={{
              width: 48, height: 48, borderRadius: "50%",
              background: BRAND.successGradient,
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              fontSize: 22, color: "#fff", marginBottom: 16,
              boxShadow: `0 0 24px ${BRAND.successGreenGlow}`,
            }}>✓</div>
            <h3 style={{
              fontFamily: "'Outfit', 'DM Sans', sans-serif",
              fontSize: 20, fontWeight: 600, color: "#fff", margin: "0 0 8px 0",
            }}>You're all set!</h3>
            <p style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 15, color: BRAND.successGreen, margin: "0 0 6px 0",
            }}>{chosenName}@zap.cooking</p>
            <p style={{
              fontFamily: "'DM Sans', sans-serif",
              fontSize: 13, color: "rgba(255,255,255,0.35)",
              margin: "0 0 24px 0", lineHeight: 1.6,
            }}>
              Your verified identity has been added to your profile.<br />
              Other Nostr clients can now verify you.
            </p>
            <button onClick={() => {}} style={{
              padding: "14px 36px", borderRadius: 14, border: "none",
              background: BRAND.orangeGradient, color: "#fff",
              fontFamily: "'DM Sans', sans-serif", fontSize: 15, fontWeight: 600,
              cursor: "pointer", boxShadow: `0 4px 20px ${BRAND.orangeGlow}`,
            }}>Start Cooking →</button>
          </div>
        )}
      </div>

      <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&family=DM+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500&family=Outfit:wght@500;600&display=swap" rel="stylesheet" />
    </div>
  );
}
