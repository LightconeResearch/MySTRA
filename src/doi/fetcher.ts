/**
 * Fetches citation metadata from doi.org as CSL-JSON.
 */

export async function fetchDOI(doi: string): Promise<any | null> {
  const url = `https://doi.org/${doi}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    const response = await fetch(url, {
      headers: {
        Accept: 'application/vnd.citationstyles.csl+json',
      },
      redirect: 'follow',
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      console.warn(`[mystra] DOI fetch failed for ${doi}: ${response.status}`);
      return null;
    }

    return await response.json();
  } catch (err) {
    console.warn(`[mystra] DOI fetch error for ${doi}:`, (err as Error).message);
    return null;
  }
}
