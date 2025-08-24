export interface ParsedSpotifyUrl {
  type: "track" | "album" | "playlist" | "artist" | "unknown";
  id: string;
}

export const parseSpotifyUrl = (url: string): ParsedSpotifyUrl => {
  const match = url.match(/https:\/\/open\.spotify\.com(?:\/intl-[a-z]{2})?\/(track|album|playlist|artist)\/([a-zA-Z0-9]+)(?:\?.*)?/);
  if (match) {
    return {
      type: match[1] as ParsedSpotifyUrl["type"],
      id: match[2],
    };
  }
  return { type: "unknown", id: "" };
};