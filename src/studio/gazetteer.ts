import type { Filter } from "./types";

type Place = { name: string; aliases: string[]; latitude: number; longitude: number; span: number };

const PLACES: Place[] = [
  { name: "Brisbane", aliases: ["brisbane", "bne", "queensland"], latitude: -27.47, longitude: 153.03, span: 0.7 },
  { name: "Sydney", aliases: ["sydney"], latitude: -33.87, longitude: 151.21, span: 0.6 },
  { name: "Melbourne", aliases: ["melbourne"], latitude: -37.81, longitude: 144.96, span: 0.6 },
  { name: "Gold Coast", aliases: ["gold coast", "surfers"], latitude: -28.0, longitude: 153.4, span: 0.4 },
  { name: "Byron Bay", aliases: ["byron"], latitude: -28.64, longitude: 153.61, span: 0.25 },
  { name: "Cairns", aliases: ["cairns"], latitude: -16.92, longitude: 145.78, span: 0.4 },
  { name: "Perth", aliases: ["perth"], latitude: -31.95, longitude: 115.86, span: 0.6 },
  { name: "Adelaide", aliases: ["adelaide"], latitude: -34.93, longitude: 138.6, span: 0.5 },
  { name: "Hobart", aliases: ["hobart", "tasmania"], latitude: -42.88, longitude: 147.33, span: 0.5 },
  { name: "Auckland", aliases: ["auckland"], latitude: -36.85, longitude: 174.76, span: 0.5 },
  { name: "London", aliases: ["london"], latitude: 51.51, longitude: -0.13, span: 0.5 },
  { name: "Paris", aliases: ["paris"], latitude: 48.86, longitude: 2.35, span: 0.4 },
  { name: "New York", aliases: ["new york", "nyc"], latitude: 40.71, longitude: -74.01, span: 0.6 },
  { name: "Los Angeles", aliases: ["los angeles", "la"], latitude: 34.05, longitude: -118.24, span: 0.7 },
  { name: "Tokyo", aliases: ["tokyo"], latitude: 35.68, longitude: 139.69, span: 0.5 },
  { name: "Kyoto", aliases: ["kyoto"], latitude: 35.01, longitude: 135.77, span: 0.35 },
  { name: "Iceland", aliases: ["iceland", "reykjavik"], latitude: 64.15, longitude: -21.94, span: 3 },
  { name: "Lisbon", aliases: ["lisbon"], latitude: 38.72, longitude: -9.14, span: 0.4 },
  { name: "Namibia", aliases: ["namibia"], latitude: -22.56, longitude: 17.08, span: 4 },
  { name: "Oslo", aliases: ["oslo"], latitude: 59.91, longitude: 10.75, span: 0.4 },
];

export function placeFilter(phrase: string): Filter | null {
  const needle = phrase.trim().toLowerCase();
  if (needle.length < 3) return null;
  const place = PLACES.find(
    (item) => item.name.toLowerCase() === needle || item.aliases.some((alias) => alias === needle || needle.includes(alias)),
  );
  if (!place) return null;
  return {
    kind: "region",
    west: place.longitude - place.span,
    east: place.longitude + place.span,
    south: place.latitude - place.span,
    north: place.latitude + place.span,
  };
}

export function takePlace(rest: string): { rest: string; filter: Filter | null } {
  const sorted = [...PLACES].sort((left, right) => right.name.length - left.name.length);
  let next = rest;
  for (const place of sorted) {
    for (const alias of [place.name, ...place.aliases]) {
      const pattern = new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
      if (!pattern.test(next)) continue;
      next = next.replace(pattern, " ");
      const filter = placeFilter(place.name);
      return { rest: next, filter };
    }
  }
  return { rest, filter: null };
}
