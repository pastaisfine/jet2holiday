import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { createPortal } from "react-dom";

export default function BottomSheet({ open, onClose, children, className = "" }) {
  const [hasTabBar, setHasTabBar] = useState(false);

  useEffect(() => {
    if (open) {
      setHasTabBar(Boolean(document.querySelector(".tabbar-mobile")));
    }
  }, [open]);

  const navClass = hasTabBar ? " sheet--with-nav" : "";

  const content = (
    <AnimatePresence initial={false}>
      {open && (
        <>
          <motion.div
            className={`overlay open ${className}`}
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.2, 0, 0, 1] }}
          />
          <motion.div
            className={`sheet open${navClass} ${className}`}
            /* bounce: 0 — the previous spring (damping 28 / stiffness 320) had a
               damping ratio of ~0.78, so the sheet overshot ~7% past its resting
               position on the way in and read as a glitch rather than a settle. */
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            /* An exit answers a tap, so it is half as long as the entrance. */
            exit={{ y: 40, opacity: 0, transition: { duration: 0.15, ease: "easeOut" } }}
            transition={{ duration: 0.3, ease: [0.2, 0, 0, 1] }}
          >
            <div className="handle" />
            {children}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );

  return createPortal(content, document.body);
}
