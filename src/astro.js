// Düşük hassasiyetli astronomi hesapları (Meeus / Astronomical Almanac yaklaşımları).
// Güneş ve Ay'ın gerçek gökyüzü konumlarını, yıldız gökyüzünün dönüşünü hesaplar.
// Dünya koordinatları: +Y yukarı, -Z kuzey, +X doğu.

const DEG = Math.PI / 180;

function daysSinceJ2000(date) {
  return date.getTime() / 86400000 - 10957.5; // 2000-01-01 12:00 UTC
}

function norm360(x) {
  x %= 360;
  return x < 0 ? x + 360 : x;
}

function eclipticToEquatorial(lon, lat, eps) {
  const sl = Math.sin(lon), cl = Math.cos(lon);
  const sb = Math.sin(lat), cb = Math.cos(lat);
  const se = Math.sin(eps), ce = Math.cos(eps);
  const ra = Math.atan2(sl * ce * cb - sb * se, cl * cb);
  const dec = Math.asin(sb * ce + cb * se * sl);
  return { ra, dec };
}

// Yerel yıldız zamanı (radyan)
function localSiderealTime(d, lonDeg) {
  const gmst = norm360(280.46061837 + 360.98564736629 * d);
  return norm360(gmst + lonDeg) * DEG;
}

// Ekvatoral (ra, dec) -> dünya yön vektörü
function equatorialToWorld(ra, dec, lst, lat, out) {
  const H = lst - ra;
  const sinAlt = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(H);
  const alt = Math.asin(Math.max(-1, Math.min(1, sinAlt)));
  const az = Math.atan2(-Math.sin(H) * Math.cos(dec),
    Math.cos(lat) * Math.sin(dec) - Math.sin(lat) * Math.cos(dec) * Math.cos(H));
  const ca = Math.cos(alt);
  out[0] = ca * Math.sin(az);
  out[1] = Math.sin(alt);
  out[2] = -ca * Math.cos(az);
  return out;
}

export function computeAstronomy(date, latDeg, lonDeg) {
  const d = daysSinceJ2000(date);
  const lat = latDeg * DEG;
  const lst = localSiderealTime(d, lonDeg);
  const eps = (23.439 - 0.0000004 * d) * DEG;

  // --- Güneş ---
  const g = norm360(357.528 + 0.9856003 * d) * DEG;
  const L = norm360(280.460 + 0.9856474 * d);
  const sunLon = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * DEG;
  const sunEq = eclipticToEquatorial(sunLon, 0, eps);
  const sunDir = equatorialToWorld(sunEq.ra, sunEq.dec, lst, lat, [0, 0, 0]);

  // --- Ay ---
  const Lm = norm360(218.316 + 13.176396 * d);
  const Mm = norm360(134.963 + 13.064993 * d) * DEG;
  const F = norm360(93.272 + 13.229350 * d) * DEG;
  const D = norm360(297.850 + 12.190749 * d) * DEG;
  const moonLon = (Lm + 6.289 * Math.sin(Mm) + 1.274 * Math.sin(2 * D - Mm)
    + 0.658 * Math.sin(2 * D) + 0.214 * Math.sin(2 * Mm) - 0.186 * Math.sin(g)) * DEG;
  const moonLat = 5.128 * Math.sin(F) * DEG;
  const moonEq = eclipticToEquatorial(moonLon, moonLat, eps);
  const moonDir = equatorialToWorld(moonEq.ra, moonEq.dec, lst, lat, [0, 0, 0]);

  // Ay'ın aydınlanan kesri (evre)
  const cosElong = Math.cos(moonLat) * Math.cos(moonLon - sunLon);
  const moonIllum = 0.5 * (1 - cosElong);

  // Ekvatoral -> dünya dönüşüm matrisi (yıldızlar için), sütunlar
  const ex = equatorialToWorld(0, 0, lst, lat, [0, 0, 0]);
  const ey = equatorialToWorld(Math.PI / 2, 0, lst, lat, [0, 0, 0]);
  const ez = equatorialToWorld(0, Math.PI / 2, lst, lat, [0, 0, 0]);

  return { sunDir, moonDir, moonIllum, eqToWorld: [ex, ey, ez] };
}

// Belirli bir konumun yerel saatinden (saat dilimi ofsetiyle) UTC Date üretir
export function makeDate(year, month, day, localHours, tzOffsetHours) {
  const ms = Date.UTC(year, month - 1, day, 0, 0, 0) + (localHours - tzOffsetHours) * 3600000;
  return new Date(ms);
}
