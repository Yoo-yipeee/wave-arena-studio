/**
 * tidy — turn a downloaded filename into something worth showing.
 *
 * Music that arrives as a file has usually been through a download site, and
 * the name carries the evidence: bitrates, site stamps, "(Official Video)",
 * track numbers, underscores. Left alone that goes straight into the library
 * and stays there, so the shelf ends up reading
 * "Gehra Hua Dhurandhar 320 Kbps" instead of "Gehra Hua".
 *
 * This only ever REMOVES known junk. It does not try to guess an artist by
 * splitting on a dash: "Artist - Title" and "Song - Movie" are equally common
 * and there is no way to tell them apart from the string, so a confident guess
 * is wrong about half the time. The artist gets its own field instead, and a
 * blank one is honest where a wrong one is not.
 */

/** Site stamps, in brackets or bare. Lowercase; matching is case-insensitive. */
const SITES = [
  'pagalworld', 'pagalfree', 'mr-jatt', 'mrjatt', 'djpunjab', 'djjohal',
  'songspk', 'songs.pk', 'webmusic', 'masstamilan', 'wapking', 'downloadming',
  'pendujatt', 'raagsong', 'bestwap', 'freshmaza', 'likewap', 'gaana',
  'saavn', 'mp3.pm', 'mp3paw', 'y2mate', 'ytmp3', 'tubidy', 'naasongs',
  'starmusiq', 'sensongs', 'teluguwap', 'hindisongs', 'bollywoodmp3',
];

/** Descriptive noise that is about the upload, not the song. */
const NOISE = [
  'official video', 'official music video', 'official audio', 'official lyric video',
  'official lyrics video', 'official visualizer', 'official trailer', 'official',
  'lyric video', 'lyrics video', 'lyrics', 'with lyrics',
  'full video song', 'full video', 'full song', 'full audio', 'video song',
  'audio song', 'song', 'music video', 'hd video', 'hd', 'hq', '4k', '1080p',
  '720p', 'remastered', 'free download', 'download', 'original motion picture',
];

const rx = (body, flags) => new RegExp(body, flags || 'gi');

export function tidyTitle(filename) {
  let s = String(filename || '');

  s = s.replace(/\.[a-z0-9]{2,5}$/i, '');          // extension
  s = s.replace(/[_+]+/g, ' ');                    // underscores, plus signs
  s = s.replace(/%20/g, ' ');                      // url-encoded spaces

  // bitrate and sample rate: "320 Kbps", "128kbps", "44.1kHz"
  s = s.replace(rx('\\(?\\[?\\s*\\d{2,3}\\s*k\\s*bps\\s*\\]?\\)?'), ' ');
  s = s.replace(rx('\\(?\\[?\\s*\\d{2,3}(\\.\\d)?\\s*khz\\s*\\]?\\)?'), ' ');

  // a bare domain anywhere: www.thing.com, thing.in, (SiteName.Com)
  s = s.replace(rx('\\(?\\[?\\s*(www\\.)?[a-z0-9-]+\\.(com|net|in|org|info|co|me|cc|pw|xyz|link|site|fun|wiki)\\s*\\]?\\)?'), ' ');

  for (const site of SITES) {
    const esc = site.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    s = s.replace(rx('\\(?\\[?\\s*-?\\s*' + esc + '[a-z0-9.\\- ]*\\]?\\)?'), ' ');
  }
  for (const n of NOISE) {
    const esc = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // only inside brackets, or as a trailing tail — never mid-title, so a song
    // genuinely called "Song for Someone" keeps its word
    s = s.replace(rx('[\\(\\[]\\s*' + esc + '\\s*[\\)\\]]'), ' ');
    s = s.replace(rx('\\s[-|–]\\s*' + esc + '\\s*$'), ' ');
  }

  s = s.replace(/^\s*\d{1,3}\s*[.\-)]\s+/, '');    // leading "01. " / "07 - "
  s = s.replace(/[\(\[]\s*[\)\]]/g, ' ');          // brackets left empty
  s = s.replace(/\s{2,}/g, ' ');
  s = s.replace(/^[\s\-–|,.]+|[\s\-–|,.]+$/g, ''); // stray edge punctuation

  return s.trim().slice(0, 120);
}
