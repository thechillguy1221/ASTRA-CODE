const configuredSiteUrl = import.meta.env.VITE_ASTRA_PUBLIC_SITE_URL as string | undefined;

/** One public-host setting drives route metadata and the static prerender. */
export const publicSiteUrl = (configuredSiteUrl ?? 'https://lyntar.dev').replace(/\/$/, '');
