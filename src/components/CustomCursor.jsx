import { useEffect, useRef } from "react";
import "./CustomCursor.css";

export default function CustomCursor() {
    const cursorRef = useRef(null);

    useEffect(() => {
        let mouseX = window.innerWidth / 2;
        let mouseY = window.innerHeight / 2;

        let currentX = mouseX;
        let currentY = mouseY;

        let lastX = mouseX;
        let lastY = mouseY;

        const colors = [
            "#ff0000",
            "#ff7f00",
            "#ffff00",
            "#00ff00",
            "#00ffff",
            "#0000ff",
            "#8b00ff",
        ];

        let colorIndex = 0;

        const createTrail = (x, y) => {
            const sparkle = document.createElement("div");

            sparkle.className = "sparkle";
            sparkle.innerHTML = "✨";

            sparkle.style.left = `${x}px`;
            sparkle.style.top = `${y}px`;

            sparkle.style.color = colors[colorIndex % colors.length];

            colorIndex++;

            document.body.appendChild(sparkle);

            setTimeout(() => {
                sparkle.remove();
            }, 1000);
        };

        const mouseMove = (e) => {
            mouseX = e.clientX;
            mouseY = e.clientY;

            createTrail(mouseX, mouseY);
        };

        window.addEventListener("mousemove", mouseMove);

        const animate = () => {
            currentX += (mouseX - currentX) * 0.15;
            currentY += (mouseY - currentY) * 0.15;

            const dx = currentX - lastX;
            const dy = currentY - lastY;

            const angle = Math.atan2(dy, dx) * (180 / Math.PI);

            if (cursorRef.current) {
                cursorRef.current.style.transform =
                    `translate(${currentX}px, ${currentY}px)`;
            }


            requestAnimationFrame(animate);
        };

        animate();

        return () => {
            window.removeEventListener("mousemove", mouseMove);
        };
    }, []);

    return (
        <div ref={cursorRef} className="plane-cursor">
            <img src="/airplane.png" alt="plane" />
        </div>
    );
}