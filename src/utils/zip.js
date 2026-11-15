// Streaming ZIP writer (stored entries, no compression: the PDFs inside are
// already compressed). Writes each file as soon as it's added, then the
// central directory on end(). Uses zlib.crc32 (Node 22.2+).

const zlib = require('zlib');

function dosDateTime(d = new Date()) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

function createZip(out) {
  const entries = [];
  let offset = 0;
  const write = buf => { out.write(buf); offset += buf.length; };

  return {
    add(name, data) {
      const nameBuf = Buffer.from(name, 'utf8');
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
      const crc = zlib.crc32(buf) >>> 0;
      const { time, date } = dosDateTime();
      const h = Buffer.alloc(30);
      h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); // UTF-8 names
      h.writeUInt16LE(0, 8); h.writeUInt16LE(time, 10); h.writeUInt16LE(date, 12);
      h.writeUInt32LE(crc, 14); h.writeUInt32LE(buf.length, 18); h.writeUInt32LE(buf.length, 22);
      h.writeUInt16LE(nameBuf.length, 26); h.writeUInt16LE(0, 28);
      entries.push({ nameBuf, crc, size: buf.length, offset, time, date });
      write(h); write(nameBuf); write(buf);
    },
    end() {
      const start = offset;
      for (const e of entries) {
        const c = Buffer.alloc(46);
        c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8);
        c.writeUInt16LE(0, 10); c.writeUInt16LE(e.time, 12); c.writeUInt16LE(e.date, 14);
        c.writeUInt32LE(e.crc, 16); c.writeUInt32LE(e.size, 20); c.writeUInt32LE(e.size, 24);
        c.writeUInt16LE(e.nameBuf.length, 28); c.writeUInt32LE(e.offset, 42);
        write(c); write(e.nameBuf);
      }
      const size = offset - start;
      const z = Buffer.alloc(22);
      z.writeUInt32LE(0x06054b50, 0); z.writeUInt16LE(entries.length, 8); z.writeUInt16LE(entries.length, 10);
      z.writeUInt32LE(size, 12); z.writeUInt32LE(start, 16);
      out.write(z);
      out.end();
    },
  };
}

module.exports = { createZip };
