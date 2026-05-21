import { useState } from 'react';

// Single source of truth for the GitHub Sponsors links. Used by the
// sidebar button, the onboarding card, and the Dashboard card. Change the
// handle here to point at a different Sponsors profile.
export const SPONSOR_URL = 'https://github.com/sponsors/gtarun';
export const SPONSOR_AVATAR = 'https://github.com/gtarun.png?size=96';

export function openSponsors() {
  window.api?.openExternal?.(SPONSOR_URL).catch(() => { /* offline — no-op */ });
}

// A full-width card with the maintainer's GitHub avatar and a Sponsor CTA.
// Falls back to a heart glyph if the avatar can't be loaded (offline).
export function SponsorCard({ sticky = false }) {
  const [avatarOk, setAvatarOk] = useState(true);
  return (
    <button className={`sponsor-card${sticky ? ' sponsor-card--sticky' : ''}`} onClick={openSponsors}>
      <span className="sponsor-card__avatar">
        {avatarOk ? (
          <img src={SPONSOR_AVATAR} alt="" onError={() => setAvatarOk(false)} />
        ) : (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 21l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.18L12 21z" />
          </svg>
        )}
      </span>
      <span className="sponsor-card__text">
        <strong>Support MacCleaner</strong>
        <span>Free and open. A sponsorship keeps it maintained.</span>
      </span>
      <span className="sponsor-card__cta">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" style={{ marginRight: 6 }}>
          <path d="M12 21l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.18L12 21z" />
        </svg>
        Sponsor
      </span>
    </button>
  );
}
