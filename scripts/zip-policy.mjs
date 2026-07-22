import { inflateRawSync } from "node:zlib";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function zipEntries(archive) {
  assert(Buffer.isBuffer(archive) && archive.length >= 22, "ZIP archive is truncated.");
  const end = archive.length - 22;
  assert(archive.readUInt32LE(end) === 0x06054b50, "ZIP end record is missing or has an archive comment.");
  assert(archive.readUInt16LE(end + 20) === 0, "ZIP archive comments are not allowed.");
  assert(archive.readUInt16LE(end + 4) === 0 && archive.readUInt16LE(end + 6) === 0, "Multi-disk ZIPs are not allowed.");
  const entryCount = archive.readUInt16LE(end + 10);
  assert(archive.readUInt16LE(end + 8) === entryCount, "ZIP entry counts disagree.");
  const centralSize = archive.readUInt32LE(end + 12);
  const centralOffset = archive.readUInt32LE(end + 16);
  assert(entryCount > 0 && entryCount <= 100, "ZIP has an unsafe file count.");
  assert(centralOffset + centralSize === end, "ZIP central-directory bounds disagree.");

  const entries = [];
  const localRanges = [];
  const names = new Set();
  let legacyBackslashes = false;
  let expandedTotal = 0;
  let offset = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    assert(offset + 46 <= end && archive.readUInt32LE(offset) === 0x02014b50, "ZIP central directory is truncated.");
    const madeBy = archive.readUInt16LE(offset + 4);
    const flags = archive.readUInt16LE(offset + 8);
    const method = archive.readUInt16LE(offset + 10);
    const checksum = archive.readUInt32LE(offset + 16);
    const compressedSize = archive.readUInt32LE(offset + 20);
    const expandedSize = archive.readUInt32LE(offset + 24);
    const nameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    const externalAttributes = archive.readUInt32LE(offset + 38);
    const localOffset = archive.readUInt32LE(offset + 42);
    const nameStart = offset + 46;
    const next = nameStart + nameLength + extraLength + commentLength;
    assert(next <= end, "ZIP central entry is truncated.");
    assert(extraLength === 0 && commentLength === 0, "ZIP entry extras and comments are not allowed.");
    assert(archive.readUInt16LE(offset + 34) === 0, "Multi-disk ZIP entries are not allowed.");
    const rawName = archive.subarray(nameStart, nameStart + nameLength).toString("utf8");
    assert(/^[\x20-\x7e]+$/.test(rawName), "ZIP paths must contain printable ASCII only.");
    const name = rawName.replaceAll("\\", "/");
    legacyBackslashes ||= rawName !== name;

    assert((flags & ~0x0800) === 0, `ZIP entry has unsupported flags or a data descriptor: ${name}`);
    assert(method === 0 || method === 8, `Unsupported ZIP compression method for ${name}.`);
    assert(name && !name.endsWith("/") && !name.startsWith("/") && !/^[A-Za-z]:/.test(name) && !name.split("/").includes(".."), `Unsafe ZIP path: ${rawName}`);
    assert(!names.has(name), `Duplicate ZIP path: ${name}`);
    names.add(name);
    if ((madeBy >> 8) === 3) assert(((externalAttributes >>> 16) & 0xf000) !== 0xa000, `Symbolic links are not allowed: ${name}`);
    assert(expandedSize <= 2 * 1024 * 1024, `ZIP entry is too large: ${name}`);
    assert(compressedSize > 0 || expandedSize === 0, `Invalid compressed size for ${name}.`);
    assert(compressedSize === 0 || expandedSize / compressedSize <= 100, `Unsafe ZIP compression ratio for ${name}.`);
    expandedTotal += expandedSize;
    assert(expandedTotal <= 5 * 1024 * 1024, "ZIP expanded size is too large.");

    assert(localOffset + 30 <= centralOffset && archive.readUInt32LE(localOffset) === 0x04034b50, `Missing local ZIP header for ${name}.`);
    const localFlags = archive.readUInt16LE(localOffset + 6);
    const localMethod = archive.readUInt16LE(localOffset + 8);
    const localChecksum = archive.readUInt32LE(localOffset + 14);
    const localCompressedSize = archive.readUInt32LE(localOffset + 18);
    const localExpandedSize = archive.readUInt32LE(localOffset + 22);
    const localNameLength = archive.readUInt16LE(localOffset + 26);
    const localExtraLength = archive.readUInt16LE(localOffset + 28);
    assert(localExtraLength === 0, `Local ZIP extras are not allowed for ${name}.`);
    const localNameStart = localOffset + 30;
    const dataStart = localNameStart + localNameLength;
    const dataEnd = dataStart + compressedSize;
    assert(localFlags === flags && localMethod === method && localChecksum === checksum, `Local ZIP metadata disagrees for ${name}.`);
    assert(localCompressedSize === compressedSize && localExpandedSize === expandedSize, `Local ZIP sizes disagree for ${name}.`);
    assert(dataEnd <= centralOffset, `Local ZIP data is truncated for ${name}.`);
    assert(archive.subarray(localNameStart, localNameStart + localNameLength).toString("utf8") === rawName, `Local and central ZIP paths disagree for ${name}.`);
    localRanges.push({ start: localOffset, end: dataEnd, name });
    const compressed = archive.subarray(dataStart, dataEnd);
    const data = method === 8 ? inflateRawSync(compressed, { maxOutputLength: 2 * 1024 * 1024 }) : Buffer.from(compressed);
    assert(data.length === expandedSize && crc32(data) === checksum, `ZIP content checksum failed for ${name}.`);
    entries.push({ name, data });
    offset = next;
  }
  assert(offset === end, "ZIP central directory contains trailing data.");

  localRanges.sort((left, right) => left.start - right.start);
  let coveredThrough = 0;
  for (const range of localRanges) {
    assert(range.start === coveredThrough, `ZIP contains a prefix, gap, overlap, or unreferenced data before ${range.name}.`);
    coveredThrough = range.end;
  }
  assert(coveredThrough === centralOffset, "ZIP contains unreferenced data before the central directory.");
  return { entries, legacyBackslashes };
}

export function validateGeneratedIcon(name, data) {
  const expectedSize = Number(name.match(/^assets\/icon-(16|32|48|128)\.png$/)?.[1]);
  assert(expectedSize, `Package contains an unexpected PNG asset: ${name}`);
  assert(data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), `${name} is not a PNG.`);
  const chunks = [];
  let offset = 8;
  while (offset < data.length) {
    assert(offset + 12 <= data.length, `${name} contains a truncated PNG chunk.`);
    const length = data.readUInt32BE(offset);
    const typeBuffer = data.subarray(offset + 4, offset + 8);
    const type = typeBuffer.toString("ascii");
    const chunkEnd = offset + 12 + length;
    assert(chunkEnd <= data.length, `${name} contains a truncated PNG chunk.`);
    const chunkData = data.subarray(offset + 8, offset + 8 + length);
    assert(crc32(Buffer.concat([typeBuffer, chunkData])) === data.readUInt32BE(offset + 8 + length), `${name} contains a corrupt PNG chunk.`);
    chunks.push({ type, data: chunkData });
    offset = chunkEnd;
  }

  assert(offset === data.length, `${name} contains trailing bytes.`);
  assert(chunks.map((chunk) => chunk.type).join(",") === "IHDR,IDAT,IEND", `${name} contains unexpected metadata or PNG chunks.`);
  const header = chunks[0].data;
  assert(header.length === 13 && header.readUInt32BE(0) === expectedSize && header.readUInt32BE(4) === expectedSize, `${name} has unexpected dimensions.`);
  assert(header[8] === 8 && header[9] === 6, `${name} has an unexpected pixel format.`);
  assert(chunks[2].data.length === 0, `${name} has an invalid end chunk.`);
}
