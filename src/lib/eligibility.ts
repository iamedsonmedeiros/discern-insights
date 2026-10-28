// src/lib/eligibility.ts
//
// Which URLs enter a DISCERN study and which are excluded before any scraping.
// DISCERN was validated for written publications about treatment choices, so
// formats outside that scope are rejected up front with an explicit status.
//
// This module is shared by the extraction worker and by the UI that documents
// the rules to the user — keep it free of server-only imports so both stay in
// sync from a single list.

import type { AnalysisStatus } from "@/lib/types";

type Platform = {
  name: string;
  /** Registrable domains; subdomains (m., www., br.) match too. */
  domains: string[];
};

/**
 * Social networks: every URL on these hosts is excluded, whatever the post type
 * (text, image, carousel, video), except SOCIAL_EXCEPTIONS. Posts are short, ephemeral, depend on
 * surrounding context (comments, media, author profile) and often sit behind a
 * login wall — none of which the DISCERN instrument was designed to assess.
 */
export const SOCIAL_PLATFORMS: Platform[] = [
  { name: "Facebook", domains: ["facebook.com", "fb.com", "fb.watch", "fb.me"] },
  { name: "Instagram", domains: ["instagram.com", "instagr.am"] },
  { name: "TikTok", domains: ["tiktok.com"] },
  { name: "X / Twitter", domains: ["x.com", "twitter.com", "t.co"] },
  { name: "Threads", domains: ["threads.net", "threads.com"] },
  { name: "LinkedIn", domains: ["linkedin.com", "lnkd.in"] },
  { name: "Pinterest", domains: ["pinterest.com", "pinterest.com.br", "pin.it"] },
  { name: "Reddit", domains: ["reddit.com", "redd.it"] },
  { name: "Kwai", domains: ["kwai.com", "kw.ai"] },
  { name: "Telegram", domains: ["t.me", "telegram.me", "telegram.org"] },
  { name: "WhatsApp", domains: ["whatsapp.com", "wa.me"] },
];

/**
 * Long-form written publications hosted on a social network. They have the shape
 * DISCERN assesses (an authored text on a topic), unlike posts on the same host.
 * Short links (lnkd.in) stay excluded: they hide the destination.
 */
const SOCIAL_EXCEPTIONS: { domains: string[]; pathPrefix: string }[] = [
  { domains: ["linkedin.com"], pathPrefix: "/pulse/" },
];

/** Video platforms: the content is the video itself, not written text. */
export const VIDEO_PLATFORMS: Platform[] = [
  { name: "YouTube", domains: ["youtube.com", "youtu.be", "youtube-nocookie.com"] },
  { name: "Vimeo", domains: ["vimeo.com"] },
  { name: "Dailymotion", domains: ["dailymotion.com", "dai.ly"] },
  { name: "Twitch", domains: ["twitch.tv"] },
  { name: "Rumble", domains: ["rumble.com"] },
];

/**
 * Below this many characters of extracted text, what came back is an error or
 * placeholder page, not an article. Real health pages extracted via Jina
 * (menus included) run well above 8k characters.
 */
export const MIN_TEXT_LENGTH = 500;

export const REJECTION_REASONS = {
  social:
    "Não elegível: post de rede social. O DISCERN foi validado para publicações escritas sobre opções de tratamento; posts são curtos, dependem de contexto (mídia, comentários, perfil) e muitas vezes exigem login, por isso ficam fora do escopo do estudo.",
  video:
    "Não elegível: plataforma de vídeo. O DISCERN avalia texto escrito; o conteúdo desta URL é o próprio vídeo.",
  pdf: "Não elegível: arquivo PDF. O estudo avalia páginas web; esta URL aponta diretamente para um PDF.",
} as const;

function hostMatches(hostname: string, domains: string[]): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return domains.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

function findPlatform(hostname: string, platforms: Platform[]): Platform | undefined {
  return platforms.find((platform) => hostMatches(hostname, platform.domains));
}

export type UrlRejection = {
  status: Extract<AnalysisStatus, "not_eligible_social" | "not_eligible_video" | "not_eligible_pdf">;
  reason: string;
};

/**
 * Decides, from the URL alone, whether it is excluded from the study.
 * Returns null when the URL is eligible for scraping.
 */
export function classifyUrl(rawUrl: string): UrlRejection | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null; // Malformed URLs fail later, at fetch time, with a precise error.
  }

  const social = findPlatform(parsed.hostname, SOCIAL_PLATFORMS);
  const isException = SOCIAL_EXCEPTIONS.some(
    (exception) =>
      hostMatches(parsed.hostname, exception.domains) &&
      parsed.pathname.toLowerCase().startsWith(exception.pathPrefix)
  );
  if (social && !isException) {
    return { status: "not_eligible_social", reason: `${REJECTION_REASONS.social} (${social.name})` };
  }

  const video = findPlatform(parsed.hostname, VIDEO_PLATFORMS);
  if (video) {
    return { status: "not_eligible_video", reason: `${REJECTION_REASONS.video} (${video.name})` };
  }

  if (parsed.pathname.toLowerCase().endsWith(".pdf")) {
    return { status: "not_eligible_pdf", reason: REJECTION_REASONS.pdf };
  }

  return null;
}
