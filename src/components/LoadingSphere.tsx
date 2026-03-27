interface LoadingSphereProps {
  size?: number;
  message?: string;
  /** Outer padding around the sphere (default 40; use ~8–12 in tight popovers). */
  padding?: number;
  /** Gap between sphere and message (default 16). */
  gap?: number;
  /** Message font size (default 15px). */
  messageFontSize?: number | string;
}

export function LoadingSphere({ 
  size = 100, 
  message = "Loading...",
  padding = 40,
  gap = 16,
  messageFontSize = "15px",
}: LoadingSphereProps) {
  const rings = 7;
  const dotsPerRing = 14;
  const dots: Array<{ x: number; y: number; z: number; delay: number }> = [];

  for (let i = 0; i < rings; i++) {
    const phi = Math.PI * (i / (rings - 1));
    for (let j = 0; j < dotsPerRing; j++) {
      const theta = (2 * Math.PI * j) / dotsPerRing;
      const x = Math.sin(phi) * Math.cos(theta);
      const y = Math.cos(phi);
      const z = Math.sin(phi) * Math.sin(theta);
      const delay = (j / dotsPerRing) * -1.5;
      dots.push({ x, y, z, delay });
    }
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: `${gap}px`,
        padding: `${padding}px`,
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          width: size,
          height: size,
          position: "relative",
          perspective: "500px",
          perspectiveOrigin: "50% 50%",
        }}
      >
        <div
          style={{
            width: "100%",
            height: "100%",
            position: "relative",
            transformStyle: "preserve-3d",
            animation: "sphereRotate 8s linear infinite",
          }}
        >
          {dots.map((dot, index) => {
            const radius = size * 0.4;
            return (
              <div
                key={index}
                style={{
                  position: "absolute",
                  left: "50%",
                  top: "50%",
                  width: "3px",
                  height: "3px",
                  borderRadius: "50%",
                  backgroundColor: "var(--accent)",
                  boxShadow: "0 0 3px var(--accent)",
                  transform: `translate3d(${dot.x * radius}px, ${dot.y * radius}px, ${dot.z * radius}px) translate(-50%, -50%)`,
                }}
              />
            );
          })}
        </div>
      </div>
      {message ? (
        <p
          style={{
            color: "var(--text-secondary)",
            fontSize: typeof messageFontSize === "number" ? `${messageFontSize}px` : messageFontSize,
            fontWeight: "500",
            margin: 0,
            textAlign: "center",
            animation: "spherePulse 1.5s ease-in-out infinite",
          }}
        >
          {message}
        </p>
      ) : null}
      <style>{`
        @keyframes sphereRotate {
          from { transform: rotateY(360deg); }
          to { transform: rotateY(0deg); }
        }
        @keyframes spherePulse {
          0%, 100% { opacity: 0.6; }
          50% { opacity: 1; }
        }
      `}</style>
    </div>
  );
}
