"use strict";
(() => {
  // tools/promo/node_modules/mp4-muxer/build/mp4-muxer.mjs
  var __accessCheck = (obj, member, msg) => {
    if (!member.has(obj))
      throw TypeError("Cannot " + msg);
  };
  var __privateGet = (obj, member, getter) => {
    __accessCheck(obj, member, "read from private field");
    return getter ? getter.call(obj) : member.get(obj);
  };
  var __privateAdd = (obj, member, value) => {
    if (member.has(obj))
      throw TypeError("Cannot add the same private member more than once");
    member instanceof WeakSet ? member.add(obj) : member.set(obj, value);
  };
  var __privateSet = (obj, member, value, setter) => {
    __accessCheck(obj, member, "write to private field");
    setter ? setter.call(obj, value) : member.set(obj, value);
    return value;
  };
  var __privateWrapper = (obj, member, setter, getter) => ({
    set _(value) {
      __privateSet(obj, member, value, setter);
    },
    get _() {
      return __privateGet(obj, member, getter);
    }
  });
  var __privateMethod = (obj, member, method) => {
    __accessCheck(obj, member, "access private method");
    return method;
  };
  var bytes = new Uint8Array(8);
  var view = new DataView(bytes.buffer);
  var u8 = (value) => {
    return [(value % 256 + 256) % 256];
  };
  var u16 = (value) => {
    view.setUint16(0, value, false);
    return [bytes[0], bytes[1]];
  };
  var i16 = (value) => {
    view.setInt16(0, value, false);
    return [bytes[0], bytes[1]];
  };
  var u24 = (value) => {
    view.setUint32(0, value, false);
    return [bytes[1], bytes[2], bytes[3]];
  };
  var u32 = (value) => {
    view.setUint32(0, value, false);
    return [bytes[0], bytes[1], bytes[2], bytes[3]];
  };
  var i32 = (value) => {
    view.setInt32(0, value, false);
    return [bytes[0], bytes[1], bytes[2], bytes[3]];
  };
  var u64 = (value) => {
    view.setUint32(0, Math.floor(value / 2 ** 32), false);
    view.setUint32(4, value, false);
    return [bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7]];
  };
  var fixed_8_8 = (value) => {
    view.setInt16(0, 2 ** 8 * value, false);
    return [bytes[0], bytes[1]];
  };
  var fixed_16_16 = (value) => {
    view.setInt32(0, 2 ** 16 * value, false);
    return [bytes[0], bytes[1], bytes[2], bytes[3]];
  };
  var fixed_2_30 = (value) => {
    view.setInt32(0, 2 ** 30 * value, false);
    return [bytes[0], bytes[1], bytes[2], bytes[3]];
  };
  var ascii = (text2, nullTerminated = false) => {
    let bytes2 = Array(text2.length).fill(null).map((_, i) => text2.charCodeAt(i));
    if (nullTerminated)
      bytes2.push(0);
    return bytes2;
  };
  var last = (arr) => {
    return arr && arr[arr.length - 1];
  };
  var lastPresentedSample = (samples) => {
    let result = void 0;
    for (let sample of samples) {
      if (!result || sample.presentationTimestamp > result.presentationTimestamp) {
        result = sample;
      }
    }
    return result;
  };
  var intoTimescale = (timeInSeconds, timescale, round = true) => {
    let value = timeInSeconds * timescale;
    return round ? Math.round(value) : value;
  };
  var rotationMatrix = (rotationInDegrees) => {
    let theta = rotationInDegrees * (Math.PI / 180);
    let cosTheta = Math.cos(theta);
    let sinTheta = Math.sin(theta);
    return [
      cosTheta,
      sinTheta,
      0,
      -sinTheta,
      cosTheta,
      0,
      0,
      0,
      1
    ];
  };
  var IDENTITY_MATRIX = rotationMatrix(0);
  var matrixToBytes = (matrix) => {
    return [
      fixed_16_16(matrix[0]),
      fixed_16_16(matrix[1]),
      fixed_2_30(matrix[2]),
      fixed_16_16(matrix[3]),
      fixed_16_16(matrix[4]),
      fixed_2_30(matrix[5]),
      fixed_16_16(matrix[6]),
      fixed_16_16(matrix[7]),
      fixed_2_30(matrix[8])
    ];
  };
  var deepClone = (x) => {
    if (!x)
      return x;
    if (typeof x !== "object")
      return x;
    if (Array.isArray(x))
      return x.map(deepClone);
    return Object.fromEntries(Object.entries(x).map(([key, value]) => [key, deepClone(value)]));
  };
  var isU32 = (value) => {
    return value >= 0 && value < 2 ** 32;
  };
  var box = (type, contents, children) => ({
    type,
    contents: contents && new Uint8Array(contents.flat(10)),
    children
  });
  var fullBox = (type, version, flags, contents, children) => box(
    type,
    [u8(version), u24(flags), contents ?? []],
    children
  );
  var ftyp = (details) => {
    let minorVersion = 512;
    if (details.fragmented)
      return box("ftyp", [
        ascii("iso5"),
        // Major brand
        u32(minorVersion),
        // Minor version
        // Compatible brands
        ascii("iso5"),
        ascii("iso6"),
        ascii("mp41")
      ]);
    return box("ftyp", [
      ascii("isom"),
      // Major brand
      u32(minorVersion),
      // Minor version
      // Compatible brands
      ascii("isom"),
      details.holdsAvc ? ascii("avc1") : [],
      ascii("mp41")
    ]);
  };
  var mdat = (reserveLargeSize) => ({ type: "mdat", largeSize: reserveLargeSize });
  var free = (size) => ({ type: "free", size });
  var moov = (tracks, creationTime, fragmented = false) => box("moov", null, [
    mvhd(creationTime, tracks),
    ...tracks.map((x) => trak(x, creationTime)),
    fragmented ? mvex(tracks) : null
  ]);
  var mvhd = (creationTime, tracks) => {
    let duration = intoTimescale(Math.max(
      0,
      ...tracks.filter((x) => x.samples.length > 0).map((x) => {
        const lastSample = lastPresentedSample(x.samples);
        return lastSample.presentationTimestamp + lastSample.duration;
      })
    ), GLOBAL_TIMESCALE);
    let nextTrackId = Math.max(...tracks.map((x) => x.id)) + 1;
    let needsU64 = !isU32(creationTime) || !isU32(duration);
    let u32OrU64 = needsU64 ? u64 : u32;
    return fullBox("mvhd", +needsU64, 0, [
      u32OrU64(creationTime),
      // Creation time
      u32OrU64(creationTime),
      // Modification time
      u32(GLOBAL_TIMESCALE),
      // Timescale
      u32OrU64(duration),
      // Duration
      fixed_16_16(1),
      // Preferred rate
      fixed_8_8(1),
      // Preferred volume
      Array(10).fill(0),
      // Reserved
      matrixToBytes(IDENTITY_MATRIX),
      // Matrix
      Array(24).fill(0),
      // Pre-defined
      u32(nextTrackId)
      // Next track ID
    ]);
  };
  var trak = (track, creationTime) => box("trak", null, [
    tkhd(track, creationTime),
    mdia(track, creationTime)
  ]);
  var tkhd = (track, creationTime) => {
    let lastSample = lastPresentedSample(track.samples);
    let durationInGlobalTimescale = intoTimescale(
      lastSample ? lastSample.presentationTimestamp + lastSample.duration : 0,
      GLOBAL_TIMESCALE
    );
    let needsU64 = !isU32(creationTime) || !isU32(durationInGlobalTimescale);
    let u32OrU64 = needsU64 ? u64 : u32;
    let matrix;
    if (track.info.type === "video") {
      matrix = typeof track.info.rotation === "number" ? rotationMatrix(track.info.rotation) : track.info.rotation;
    } else {
      matrix = IDENTITY_MATRIX;
    }
    return fullBox("tkhd", +needsU64, 3, [
      u32OrU64(creationTime),
      // Creation time
      u32OrU64(creationTime),
      // Modification time
      u32(track.id),
      // Track ID
      u32(0),
      // Reserved
      u32OrU64(durationInGlobalTimescale),
      // Duration
      Array(8).fill(0),
      // Reserved
      u16(0),
      // Layer
      u16(0),
      // Alternate group
      fixed_8_8(track.info.type === "audio" ? 1 : 0),
      // Volume
      u16(0),
      // Reserved
      matrixToBytes(matrix),
      // Matrix
      fixed_16_16(track.info.type === "video" ? track.info.width : 0),
      // Track width
      fixed_16_16(track.info.type === "video" ? track.info.height : 0)
      // Track height
    ]);
  };
  var mdia = (track, creationTime) => box("mdia", null, [
    mdhd(track, creationTime),
    hdlr(track.info.type === "video" ? "vide" : "soun"),
    minf(track)
  ]);
  var mdhd = (track, creationTime) => {
    let lastSample = lastPresentedSample(track.samples);
    let localDuration = intoTimescale(
      lastSample ? lastSample.presentationTimestamp + lastSample.duration : 0,
      track.timescale
    );
    let needsU64 = !isU32(creationTime) || !isU32(localDuration);
    let u32OrU64 = needsU64 ? u64 : u32;
    return fullBox("mdhd", +needsU64, 0, [
      u32OrU64(creationTime),
      // Creation time
      u32OrU64(creationTime),
      // Modification time
      u32(track.timescale),
      // Timescale
      u32OrU64(localDuration),
      // Duration
      u16(21956),
      // Language ("und", undetermined)
      u16(0)
      // Quality
    ]);
  };
  var hdlr = (componentSubtype) => fullBox("hdlr", 0, 0, [
    ascii("mhlr"),
    // Component type
    ascii(componentSubtype),
    // Component subtype
    u32(0),
    // Component manufacturer
    u32(0),
    // Component flags
    u32(0),
    // Component flags mask
    ascii("mp4-muxer-hdlr", true)
    // Component name
  ]);
  var minf = (track) => box("minf", null, [
    track.info.type === "video" ? vmhd() : smhd(),
    dinf(),
    stbl(track)
  ]);
  var vmhd = () => fullBox("vmhd", 0, 1, [
    u16(0),
    // Graphics mode
    u16(0),
    // Opcolor R
    u16(0),
    // Opcolor G
    u16(0)
    // Opcolor B
  ]);
  var smhd = () => fullBox("smhd", 0, 0, [
    u16(0),
    // Balance
    u16(0)
    // Reserved
  ]);
  var dinf = () => box("dinf", null, [
    dref()
  ]);
  var dref = () => fullBox("dref", 0, 0, [
    u32(1)
    // Entry count
  ], [
    url()
  ]);
  var url = () => fullBox("url ", 0, 1);
  var stbl = (track) => {
    const needsCtts = track.compositionTimeOffsetTable.length > 1 || track.compositionTimeOffsetTable.some((x) => x.sampleCompositionTimeOffset !== 0);
    return box("stbl", null, [
      stsd(track),
      stts(track),
      stss(track),
      stsc(track),
      stsz(track),
      stco(track),
      needsCtts ? ctts(track) : null
    ]);
  };
  var stsd = (track) => fullBox("stsd", 0, 0, [
    u32(1)
    // Entry count
  ], [
    track.info.type === "video" ? videoSampleDescription(
      VIDEO_CODEC_TO_BOX_NAME[track.info.codec],
      track
    ) : soundSampleDescription(
      AUDIO_CODEC_TO_BOX_NAME[track.info.codec],
      track
    )
  ]);
  var videoSampleDescription = (compressionType, track) => box(compressionType, [
    Array(6).fill(0),
    // Reserved
    u16(1),
    // Data reference index
    u16(0),
    // Pre-defined
    u16(0),
    // Reserved
    Array(12).fill(0),
    // Pre-defined
    u16(track.info.width),
    // Width
    u16(track.info.height),
    // Height
    u32(4718592),
    // Horizontal resolution
    u32(4718592),
    // Vertical resolution
    u32(0),
    // Reserved
    u16(1),
    // Frame count
    Array(32).fill(0),
    // Compressor name
    u16(24),
    // Depth
    i16(65535)
    // Pre-defined
  ], [
    VIDEO_CODEC_TO_CONFIGURATION_BOX[track.info.codec](track),
    track.info.decoderConfig.colorSpace ? colr(track) : null
  ]);
  var COLOR_PRIMARIES_MAP = {
    "bt709": 1,
    // ITU-R BT.709
    "bt470bg": 5,
    // ITU-R BT.470BG
    "smpte170m": 6
    // ITU-R BT.601 525 - SMPTE 170M
  };
  var TRANSFER_CHARACTERISTICS_MAP = {
    "bt709": 1,
    // ITU-R BT.709
    "smpte170m": 6,
    // SMPTE 170M
    "iec61966-2-1": 13
    // IEC 61966-2-1
  };
  var MATRIX_COEFFICIENTS_MAP = {
    "rgb": 0,
    // Identity
    "bt709": 1,
    // ITU-R BT.709
    "bt470bg": 5,
    // ITU-R BT.470BG
    "smpte170m": 6
    // SMPTE 170M
  };
  var colr = (track) => box("colr", [
    ascii("nclx"),
    // Colour type
    u16(COLOR_PRIMARIES_MAP[track.info.decoderConfig.colorSpace.primaries]),
    // Colour primaries
    u16(TRANSFER_CHARACTERISTICS_MAP[track.info.decoderConfig.colorSpace.transfer]),
    // Transfer characteristics
    u16(MATRIX_COEFFICIENTS_MAP[track.info.decoderConfig.colorSpace.matrix]),
    // Matrix coefficients
    u8((track.info.decoderConfig.colorSpace.fullRange ? 1 : 0) << 7)
    // Full range flag
  ]);
  var avcC = (track) => track.info.decoderConfig && box("avcC", [
    // For AVC, description is an AVCDecoderConfigurationRecord, so nothing else to do here
    ...new Uint8Array(track.info.decoderConfig.description)
  ]);
  var hvcC = (track) => track.info.decoderConfig && box("hvcC", [
    // For HEVC, description is a HEVCDecoderConfigurationRecord, so nothing else to do here
    ...new Uint8Array(track.info.decoderConfig.description)
  ]);
  var vpcC = (track) => {
    if (!track.info.decoderConfig) {
      return null;
    }
    let decoderConfig = track.info.decoderConfig;
    if (!decoderConfig.colorSpace) {
      throw new Error(`'colorSpace' is required in the decoder config for VP9.`);
    }
    let parts = decoderConfig.codec.split(".");
    let profile = Number(parts[1]);
    let level = Number(parts[2]);
    let bitDepth = Number(parts[3]);
    let chromaSubsampling = 0;
    let thirdByte = (bitDepth << 4) + (chromaSubsampling << 1) + Number(decoderConfig.colorSpace.fullRange);
    let colourPrimaries = 2;
    let transferCharacteristics = 2;
    let matrixCoefficients = 2;
    return fullBox("vpcC", 1, 0, [
      u8(profile),
      // Profile
      u8(level),
      // Level
      u8(thirdByte),
      // Bit depth, chroma subsampling, full range
      u8(colourPrimaries),
      // Colour primaries
      u8(transferCharacteristics),
      // Transfer characteristics
      u8(matrixCoefficients),
      // Matrix coefficients
      u16(0)
      // Codec initialization data size
    ]);
  };
  var av1C = () => {
    let marker = 1;
    let version = 1;
    let firstByte = (marker << 7) + version;
    return box("av1C", [
      firstByte,
      0,
      0,
      0
    ]);
  };
  var soundSampleDescription = (compressionType, track) => box(compressionType, [
    Array(6).fill(0),
    // Reserved
    u16(1),
    // Data reference index
    u16(0),
    // Version
    u16(0),
    // Revision level
    u32(0),
    // Vendor
    u16(track.info.numberOfChannels),
    // Number of channels
    u16(16),
    // Sample size (bits)
    u16(0),
    // Compression ID
    u16(0),
    // Packet size
    fixed_16_16(track.info.sampleRate)
    // Sample rate
  ], [
    AUDIO_CODEC_TO_CONFIGURATION_BOX[track.info.codec](track)
  ]);
  var esds = (track) => {
    let description = new Uint8Array(track.info.decoderConfig.description);
    return fullBox("esds", 0, 0, [
      // https://stackoverflow.com/a/54803118
      u32(58753152),
      // TAG(3) = Object Descriptor ([2])
      u8(32 + description.byteLength),
      // length of this OD (which includes the next 2 tags)
      u16(1),
      // ES_ID = 1
      u8(0),
      // flags etc = 0
      u32(75530368),
      // TAG(4) = ES Descriptor ([2]) embedded in above OD
      u8(18 + description.byteLength),
      // length of this ESD
      u8(64),
      // MPEG-4 Audio
      u8(21),
      // stream type(6bits)=5 audio, flags(2bits)=1
      u24(0),
      // 24bit buffer size
      u32(130071),
      // max bitrate
      u32(130071),
      // avg bitrate
      u32(92307584),
      // TAG(5) = ASC ([2],[3]) embedded in above OD
      u8(description.byteLength),
      // length
      ...description,
      u32(109084800),
      // TAG(6)
      u8(1),
      // length
      u8(2)
      // data
    ]);
  };
  var dOps = (track) => {
    let preskip = 3840;
    let gain = 0;
    const description = track.info.decoderConfig?.description;
    if (description) {
      if (description.byteLength < 18) {
        throw new TypeError("Invalid decoder description provided for Opus; must be at least 18 bytes long.");
      }
      const view2 = ArrayBuffer.isView(description) ? new DataView(description.buffer, description.byteOffset, description.byteLength) : new DataView(description);
      preskip = view2.getUint16(10, true);
      gain = view2.getInt16(14, true);
    }
    return box("dOps", [
      u8(0),
      // Version
      u8(track.info.numberOfChannels),
      // OutputChannelCount
      u16(preskip),
      u32(track.info.sampleRate),
      // InputSampleRate
      fixed_8_8(gain),
      // OutputGain
      u8(0)
      // ChannelMappingFamily
    ]);
  };
  var stts = (track) => {
    return fullBox("stts", 0, 0, [
      u32(track.timeToSampleTable.length),
      // Number of entries
      track.timeToSampleTable.map((x) => [
        // Time-to-sample table
        u32(x.sampleCount),
        // Sample count
        u32(x.sampleDelta)
        // Sample duration
      ])
    ]);
  };
  var stss = (track) => {
    if (track.samples.every((x) => x.type === "key"))
      return null;
    let keySamples = [...track.samples.entries()].filter(([, sample]) => sample.type === "key");
    return fullBox("stss", 0, 0, [
      u32(keySamples.length),
      // Number of entries
      keySamples.map(([index]) => u32(index + 1))
      // Sync sample table
    ]);
  };
  var stsc = (track) => {
    return fullBox("stsc", 0, 0, [
      u32(track.compactlyCodedChunkTable.length),
      // Number of entries
      track.compactlyCodedChunkTable.map((x) => [
        // Sample-to-chunk table
        u32(x.firstChunk),
        // First chunk
        u32(x.samplesPerChunk),
        // Samples per chunk
        u32(1)
        // Sample description index
      ])
    ]);
  };
  var stsz = (track) => fullBox("stsz", 0, 0, [
    u32(0),
    // Sample size (0 means non-constant size)
    u32(track.samples.length),
    // Number of entries
    track.samples.map((x) => u32(x.size))
    // Sample size table
  ]);
  var stco = (track) => {
    if (track.finalizedChunks.length > 0 && last(track.finalizedChunks).offset >= 2 ** 32) {
      return fullBox("co64", 0, 0, [
        u32(track.finalizedChunks.length),
        // Number of entries
        track.finalizedChunks.map((x) => u64(x.offset))
        // Chunk offset table
      ]);
    }
    return fullBox("stco", 0, 0, [
      u32(track.finalizedChunks.length),
      // Number of entries
      track.finalizedChunks.map((x) => u32(x.offset))
      // Chunk offset table
    ]);
  };
  var ctts = (track) => {
    return fullBox("ctts", 0, 0, [
      u32(track.compositionTimeOffsetTable.length),
      // Number of entries
      track.compositionTimeOffsetTable.map((x) => [
        // Time-to-sample table
        u32(x.sampleCount),
        // Sample count
        u32(x.sampleCompositionTimeOffset)
        // Sample offset
      ])
    ]);
  };
  var mvex = (tracks) => {
    return box("mvex", null, tracks.map(trex));
  };
  var trex = (track) => {
    return fullBox("trex", 0, 0, [
      u32(track.id),
      // Track ID
      u32(1),
      // Default sample description index
      u32(0),
      // Default sample duration
      u32(0),
      // Default sample size
      u32(0)
      // Default sample flags
    ]);
  };
  var moof = (sequenceNumber, tracks) => {
    return box("moof", null, [
      mfhd(sequenceNumber),
      ...tracks.map(traf)
    ]);
  };
  var mfhd = (sequenceNumber) => {
    return fullBox("mfhd", 0, 0, [
      u32(sequenceNumber)
      // Sequence number
    ]);
  };
  var fragmentSampleFlags = (sample) => {
    let byte1 = 0;
    let byte2 = 0;
    let byte3 = 0;
    let byte4 = 0;
    let sampleIsDifferenceSample = sample.type === "delta";
    byte2 |= +sampleIsDifferenceSample;
    if (sampleIsDifferenceSample) {
      byte1 |= 1;
    } else {
      byte1 |= 2;
    }
    return byte1 << 24 | byte2 << 16 | byte3 << 8 | byte4;
  };
  var traf = (track) => {
    return box("traf", null, [
      tfhd(track),
      tfdt(track),
      trun(track)
    ]);
  };
  var tfhd = (track) => {
    let tfFlags = 0;
    tfFlags |= 8;
    tfFlags |= 16;
    tfFlags |= 32;
    tfFlags |= 131072;
    let referenceSample = track.currentChunk.samples[1] ?? track.currentChunk.samples[0];
    let referenceSampleInfo = {
      duration: referenceSample.timescaleUnitsToNextSample,
      size: referenceSample.size,
      flags: fragmentSampleFlags(referenceSample)
    };
    return fullBox("tfhd", 0, tfFlags, [
      u32(track.id),
      // Track ID
      u32(referenceSampleInfo.duration),
      // Default sample duration
      u32(referenceSampleInfo.size),
      // Default sample size
      u32(referenceSampleInfo.flags)
      // Default sample flags
    ]);
  };
  var tfdt = (track) => {
    return fullBox("tfdt", 1, 0, [
      u64(intoTimescale(track.currentChunk.startTimestamp, track.timescale))
      // Base Media Decode Time
    ]);
  };
  var trun = (track) => {
    let allSampleDurations = track.currentChunk.samples.map((x) => x.timescaleUnitsToNextSample);
    let allSampleSizes = track.currentChunk.samples.map((x) => x.size);
    let allSampleFlags = track.currentChunk.samples.map(fragmentSampleFlags);
    let allSampleCompositionTimeOffsets = track.currentChunk.samples.map((x) => intoTimescale(x.presentationTimestamp - x.decodeTimestamp, track.timescale));
    let uniqueSampleDurations = new Set(allSampleDurations);
    let uniqueSampleSizes = new Set(allSampleSizes);
    let uniqueSampleFlags = new Set(allSampleFlags);
    let uniqueSampleCompositionTimeOffsets = new Set(allSampleCompositionTimeOffsets);
    let firstSampleFlagsPresent = uniqueSampleFlags.size === 2 && allSampleFlags[0] !== allSampleFlags[1];
    let sampleDurationPresent = uniqueSampleDurations.size > 1;
    let sampleSizePresent = uniqueSampleSizes.size > 1;
    let sampleFlagsPresent = !firstSampleFlagsPresent && uniqueSampleFlags.size > 1;
    let sampleCompositionTimeOffsetsPresent = uniqueSampleCompositionTimeOffsets.size > 1 || [...uniqueSampleCompositionTimeOffsets].some((x) => x !== 0);
    let flags = 0;
    flags |= 1;
    flags |= 4 * +firstSampleFlagsPresent;
    flags |= 256 * +sampleDurationPresent;
    flags |= 512 * +sampleSizePresent;
    flags |= 1024 * +sampleFlagsPresent;
    flags |= 2048 * +sampleCompositionTimeOffsetsPresent;
    return fullBox("trun", 1, flags, [
      u32(track.currentChunk.samples.length),
      // Sample count
      u32(track.currentChunk.offset - track.currentChunk.moofOffset || 0),
      // Data offset
      firstSampleFlagsPresent ? u32(allSampleFlags[0]) : [],
      track.currentChunk.samples.map((_, i) => [
        sampleDurationPresent ? u32(allSampleDurations[i]) : [],
        // Sample duration
        sampleSizePresent ? u32(allSampleSizes[i]) : [],
        // Sample size
        sampleFlagsPresent ? u32(allSampleFlags[i]) : [],
        // Sample flags
        // Sample composition time offsets
        sampleCompositionTimeOffsetsPresent ? i32(allSampleCompositionTimeOffsets[i]) : []
      ])
    ]);
  };
  var mfra = (tracks) => {
    return box("mfra", null, [
      ...tracks.map(tfra),
      mfro()
    ]);
  };
  var tfra = (track, trackIndex) => {
    let version = 1;
    return fullBox("tfra", version, 0, [
      u32(track.id),
      // Track ID
      u32(63),
      // This specifies that traf number, trun number and sample number are 32-bit ints
      u32(track.finalizedChunks.length),
      // Number of entries
      track.finalizedChunks.map((chunk) => [
        u64(intoTimescale(chunk.startTimestamp, track.timescale)),
        // Time
        u64(chunk.moofOffset),
        // moof offset
        u32(trackIndex + 1),
        // traf number
        u32(1),
        // trun number
        u32(1)
        // Sample number
      ])
    ]);
  };
  var mfro = () => {
    return fullBox("mfro", 0, 0, [
      // This value needs to be overwritten manually from the outside, where the actual size of the enclosing mfra box
      // is known
      u32(0)
      // Size
    ]);
  };
  var VIDEO_CODEC_TO_BOX_NAME = {
    "avc": "avc1",
    "hevc": "hvc1",
    "vp9": "vp09",
    "av1": "av01"
  };
  var VIDEO_CODEC_TO_CONFIGURATION_BOX = {
    "avc": avcC,
    "hevc": hvcC,
    "vp9": vpcC,
    "av1": av1C
  };
  var AUDIO_CODEC_TO_BOX_NAME = {
    "aac": "mp4a",
    "opus": "Opus"
  };
  var AUDIO_CODEC_TO_CONFIGURATION_BOX = {
    "aac": esds,
    "opus": dOps
  };
  var Target = class {
  };
  var ArrayBufferTarget = class extends Target {
    constructor() {
      super(...arguments);
      this.buffer = null;
    }
  };
  var StreamTarget = class extends Target {
    constructor(options) {
      super();
      this.options = options;
      if (typeof options !== "object") {
        throw new TypeError("StreamTarget requires an options object to be passed to its constructor.");
      }
      if (options.onData) {
        if (typeof options.onData !== "function") {
          throw new TypeError("options.onData, when provided, must be a function.");
        }
        if (options.onData.length < 2) {
          throw new TypeError(
            "options.onData, when provided, must be a function that takes in at least two arguments (data and position). Ignoring the position argument, which specifies the byte offset at which the data is to be written, can lead to broken outputs."
          );
        }
      }
      if (options.chunked !== void 0 && typeof options.chunked !== "boolean") {
        throw new TypeError("options.chunked, when provided, must be a boolean.");
      }
      if (options.chunkSize !== void 0 && (!Number.isInteger(options.chunkSize) || options.chunkSize < 1024)) {
        throw new TypeError("options.chunkSize, when provided, must be an integer and not smaller than 1024.");
      }
    }
  };
  var FileSystemWritableFileStreamTarget = class extends Target {
    constructor(stream, options) {
      super();
      this.stream = stream;
      this.options = options;
      if (!(stream instanceof FileSystemWritableFileStream)) {
        throw new TypeError("FileSystemWritableFileStreamTarget requires a FileSystemWritableFileStream instance.");
      }
      if (options !== void 0 && typeof options !== "object") {
        throw new TypeError("FileSystemWritableFileStreamTarget's options, when provided, must be an object.");
      }
      if (options) {
        if (options.chunkSize !== void 0 && (!Number.isInteger(options.chunkSize) || options.chunkSize <= 0)) {
          throw new TypeError("options.chunkSize, when provided, must be a positive integer");
        }
      }
    }
  };
  var _helper;
  var _helperView;
  var Writer = class {
    constructor() {
      this.pos = 0;
      __privateAdd(this, _helper, new Uint8Array(8));
      __privateAdd(this, _helperView, new DataView(__privateGet(this, _helper).buffer));
      this.offsets = /* @__PURE__ */ new WeakMap();
    }
    /** Sets the current position for future writes to a new one. */
    seek(newPos) {
      this.pos = newPos;
    }
    writeU32(value) {
      __privateGet(this, _helperView).setUint32(0, value, false);
      this.write(__privateGet(this, _helper).subarray(0, 4));
    }
    writeU64(value) {
      __privateGet(this, _helperView).setUint32(0, Math.floor(value / 2 ** 32), false);
      __privateGet(this, _helperView).setUint32(4, value, false);
      this.write(__privateGet(this, _helper).subarray(0, 8));
    }
    writeAscii(text2) {
      for (let i = 0; i < text2.length; i++) {
        __privateGet(this, _helperView).setUint8(i % 8, text2.charCodeAt(i));
        if (i % 8 === 7)
          this.write(__privateGet(this, _helper));
      }
      if (text2.length % 8 !== 0) {
        this.write(__privateGet(this, _helper).subarray(0, text2.length % 8));
      }
    }
    writeBox(box2) {
      this.offsets.set(box2, this.pos);
      if (box2.contents && !box2.children) {
        this.writeBoxHeader(box2, box2.size ?? box2.contents.byteLength + 8);
        this.write(box2.contents);
      } else {
        let startPos = this.pos;
        this.writeBoxHeader(box2, 0);
        if (box2.contents)
          this.write(box2.contents);
        if (box2.children) {
          for (let child of box2.children)
            if (child)
              this.writeBox(child);
        }
        let endPos = this.pos;
        let size = box2.size ?? endPos - startPos;
        this.seek(startPos);
        this.writeBoxHeader(box2, size);
        this.seek(endPos);
      }
    }
    writeBoxHeader(box2, size) {
      this.writeU32(box2.largeSize ? 1 : size);
      this.writeAscii(box2.type);
      if (box2.largeSize)
        this.writeU64(size);
    }
    measureBoxHeader(box2) {
      return 8 + (box2.largeSize ? 8 : 0);
    }
    patchBox(box2) {
      let endPos = this.pos;
      this.seek(this.offsets.get(box2));
      this.writeBox(box2);
      this.seek(endPos);
    }
    measureBox(box2) {
      if (box2.contents && !box2.children) {
        let headerSize = this.measureBoxHeader(box2);
        return headerSize + box2.contents.byteLength;
      } else {
        let result = this.measureBoxHeader(box2);
        if (box2.contents)
          result += box2.contents.byteLength;
        if (box2.children) {
          for (let child of box2.children)
            if (child)
              result += this.measureBox(child);
        }
        return result;
      }
    }
  };
  _helper = /* @__PURE__ */ new WeakMap();
  _helperView = /* @__PURE__ */ new WeakMap();
  var _target;
  var _buffer;
  var _bytes;
  var _maxPos;
  var _ensureSize;
  var ensureSize_fn;
  var ArrayBufferTargetWriter = class extends Writer {
    constructor(target) {
      super();
      __privateAdd(this, _ensureSize);
      __privateAdd(this, _target, void 0);
      __privateAdd(this, _buffer, new ArrayBuffer(2 ** 16));
      __privateAdd(this, _bytes, new Uint8Array(__privateGet(this, _buffer)));
      __privateAdd(this, _maxPos, 0);
      __privateSet(this, _target, target);
    }
    write(data) {
      __privateMethod(this, _ensureSize, ensureSize_fn).call(this, this.pos + data.byteLength);
      __privateGet(this, _bytes).set(data, this.pos);
      this.pos += data.byteLength;
      __privateSet(this, _maxPos, Math.max(__privateGet(this, _maxPos), this.pos));
    }
    finalize() {
      __privateMethod(this, _ensureSize, ensureSize_fn).call(this, this.pos);
      __privateGet(this, _target).buffer = __privateGet(this, _buffer).slice(0, Math.max(__privateGet(this, _maxPos), this.pos));
    }
  };
  _target = /* @__PURE__ */ new WeakMap();
  _buffer = /* @__PURE__ */ new WeakMap();
  _bytes = /* @__PURE__ */ new WeakMap();
  _maxPos = /* @__PURE__ */ new WeakMap();
  _ensureSize = /* @__PURE__ */ new WeakSet();
  ensureSize_fn = function(size) {
    let newLength = __privateGet(this, _buffer).byteLength;
    while (newLength < size)
      newLength *= 2;
    if (newLength === __privateGet(this, _buffer).byteLength)
      return;
    let newBuffer = new ArrayBuffer(newLength);
    let newBytes = new Uint8Array(newBuffer);
    newBytes.set(__privateGet(this, _bytes), 0);
    __privateSet(this, _buffer, newBuffer);
    __privateSet(this, _bytes, newBytes);
  };
  var DEFAULT_CHUNK_SIZE = 2 ** 24;
  var MAX_CHUNKS_AT_ONCE = 2;
  var _target2;
  var _sections;
  var _chunked;
  var _chunkSize;
  var _chunks;
  var _writeDataIntoChunks;
  var writeDataIntoChunks_fn;
  var _insertSectionIntoChunk;
  var insertSectionIntoChunk_fn;
  var _createChunk;
  var createChunk_fn;
  var _flushChunks;
  var flushChunks_fn;
  var StreamTargetWriter = class extends Writer {
    constructor(target) {
      super();
      __privateAdd(this, _writeDataIntoChunks);
      __privateAdd(this, _insertSectionIntoChunk);
      __privateAdd(this, _createChunk);
      __privateAdd(this, _flushChunks);
      __privateAdd(this, _target2, void 0);
      __privateAdd(this, _sections, []);
      __privateAdd(this, _chunked, void 0);
      __privateAdd(this, _chunkSize, void 0);
      __privateAdd(this, _chunks, []);
      __privateSet(this, _target2, target);
      __privateSet(this, _chunked, target.options?.chunked ?? false);
      __privateSet(this, _chunkSize, target.options?.chunkSize ?? DEFAULT_CHUNK_SIZE);
    }
    write(data) {
      __privateGet(this, _sections).push({
        data: data.slice(),
        start: this.pos
      });
      this.pos += data.byteLength;
    }
    flush() {
      if (__privateGet(this, _sections).length === 0)
        return;
      let chunks = [];
      let sorted = [...__privateGet(this, _sections)].sort((a, b) => a.start - b.start);
      chunks.push({
        start: sorted[0].start,
        size: sorted[0].data.byteLength
      });
      for (let i = 1; i < sorted.length; i++) {
        let lastChunk = chunks[chunks.length - 1];
        let section = sorted[i];
        if (section.start <= lastChunk.start + lastChunk.size) {
          lastChunk.size = Math.max(lastChunk.size, section.start + section.data.byteLength - lastChunk.start);
        } else {
          chunks.push({
            start: section.start,
            size: section.data.byteLength
          });
        }
      }
      for (let chunk of chunks) {
        chunk.data = new Uint8Array(chunk.size);
        for (let section of __privateGet(this, _sections)) {
          if (chunk.start <= section.start && section.start < chunk.start + chunk.size) {
            chunk.data.set(section.data, section.start - chunk.start);
          }
        }
        if (__privateGet(this, _chunked)) {
          __privateMethod(this, _writeDataIntoChunks, writeDataIntoChunks_fn).call(this, chunk.data, chunk.start);
          __privateMethod(this, _flushChunks, flushChunks_fn).call(this);
        } else {
          __privateGet(this, _target2).options.onData?.(chunk.data, chunk.start);
        }
      }
      __privateGet(this, _sections).length = 0;
    }
    finalize() {
      if (__privateGet(this, _chunked)) {
        __privateMethod(this, _flushChunks, flushChunks_fn).call(this, true);
      }
    }
  };
  _target2 = /* @__PURE__ */ new WeakMap();
  _sections = /* @__PURE__ */ new WeakMap();
  _chunked = /* @__PURE__ */ new WeakMap();
  _chunkSize = /* @__PURE__ */ new WeakMap();
  _chunks = /* @__PURE__ */ new WeakMap();
  _writeDataIntoChunks = /* @__PURE__ */ new WeakSet();
  writeDataIntoChunks_fn = function(data, position) {
    let chunkIndex = __privateGet(this, _chunks).findIndex((x) => x.start <= position && position < x.start + __privateGet(this, _chunkSize));
    if (chunkIndex === -1)
      chunkIndex = __privateMethod(this, _createChunk, createChunk_fn).call(this, position);
    let chunk = __privateGet(this, _chunks)[chunkIndex];
    let relativePosition = position - chunk.start;
    let toWrite = data.subarray(0, Math.min(__privateGet(this, _chunkSize) - relativePosition, data.byteLength));
    chunk.data.set(toWrite, relativePosition);
    let section = {
      start: relativePosition,
      end: relativePosition + toWrite.byteLength
    };
    __privateMethod(this, _insertSectionIntoChunk, insertSectionIntoChunk_fn).call(this, chunk, section);
    if (chunk.written[0].start === 0 && chunk.written[0].end === __privateGet(this, _chunkSize)) {
      chunk.shouldFlush = true;
    }
    if (__privateGet(this, _chunks).length > MAX_CHUNKS_AT_ONCE) {
      for (let i = 0; i < __privateGet(this, _chunks).length - 1; i++) {
        __privateGet(this, _chunks)[i].shouldFlush = true;
      }
      __privateMethod(this, _flushChunks, flushChunks_fn).call(this);
    }
    if (toWrite.byteLength < data.byteLength) {
      __privateMethod(this, _writeDataIntoChunks, writeDataIntoChunks_fn).call(this, data.subarray(toWrite.byteLength), position + toWrite.byteLength);
    }
  };
  _insertSectionIntoChunk = /* @__PURE__ */ new WeakSet();
  insertSectionIntoChunk_fn = function(chunk, section) {
    let low = 0;
    let high = chunk.written.length - 1;
    let index = -1;
    while (low <= high) {
      let mid = Math.floor(low + (high - low + 1) / 2);
      if (chunk.written[mid].start <= section.start) {
        low = mid + 1;
        index = mid;
      } else {
        high = mid - 1;
      }
    }
    chunk.written.splice(index + 1, 0, section);
    if (index === -1 || chunk.written[index].end < section.start)
      index++;
    while (index < chunk.written.length - 1 && chunk.written[index].end >= chunk.written[index + 1].start) {
      chunk.written[index].end = Math.max(chunk.written[index].end, chunk.written[index + 1].end);
      chunk.written.splice(index + 1, 1);
    }
  };
  _createChunk = /* @__PURE__ */ new WeakSet();
  createChunk_fn = function(includesPosition) {
    let start = Math.floor(includesPosition / __privateGet(this, _chunkSize)) * __privateGet(this, _chunkSize);
    let chunk = {
      start,
      data: new Uint8Array(__privateGet(this, _chunkSize)),
      written: [],
      shouldFlush: false
    };
    __privateGet(this, _chunks).push(chunk);
    __privateGet(this, _chunks).sort((a, b) => a.start - b.start);
    return __privateGet(this, _chunks).indexOf(chunk);
  };
  _flushChunks = /* @__PURE__ */ new WeakSet();
  flushChunks_fn = function(force = false) {
    for (let i = 0; i < __privateGet(this, _chunks).length; i++) {
      let chunk = __privateGet(this, _chunks)[i];
      if (!chunk.shouldFlush && !force)
        continue;
      for (let section of chunk.written) {
        __privateGet(this, _target2).options.onData?.(
          chunk.data.subarray(section.start, section.end),
          chunk.start + section.start
        );
      }
      __privateGet(this, _chunks).splice(i--, 1);
    }
  };
  var FileSystemWritableFileStreamTargetWriter = class extends StreamTargetWriter {
    constructor(target) {
      super(new StreamTarget({
        onData: (data, position) => target.stream.write({
          type: "write",
          data,
          position
        }),
        chunked: true,
        chunkSize: target.options?.chunkSize
      }));
    }
  };
  var GLOBAL_TIMESCALE = 1e3;
  var SUPPORTED_VIDEO_CODECS = ["avc", "hevc", "vp9", "av1"];
  var SUPPORTED_AUDIO_CODECS = ["aac", "opus"];
  var TIMESTAMP_OFFSET = 2082844800;
  var FIRST_TIMESTAMP_BEHAVIORS = ["strict", "offset", "cross-track-offset"];
  var _options;
  var _writer;
  var _ftypSize;
  var _mdat;
  var _videoTrack;
  var _audioTrack;
  var _creationTime;
  var _finalizedChunks;
  var _nextFragmentNumber;
  var _videoSampleQueue;
  var _audioSampleQueue;
  var _finalized;
  var _validateOptions;
  var validateOptions_fn;
  var _writeHeader;
  var writeHeader_fn;
  var _computeMoovSizeUpperBound;
  var computeMoovSizeUpperBound_fn;
  var _prepareTracks;
  var prepareTracks_fn;
  var _generateMpeg4AudioSpecificConfig;
  var generateMpeg4AudioSpecificConfig_fn;
  var _createSampleForTrack;
  var createSampleForTrack_fn;
  var _addSampleToTrack;
  var addSampleToTrack_fn;
  var _validateTimestamp;
  var validateTimestamp_fn;
  var _finalizeCurrentChunk;
  var finalizeCurrentChunk_fn;
  var _finalizeFragment;
  var finalizeFragment_fn;
  var _maybeFlushStreamingTargetWriter;
  var maybeFlushStreamingTargetWriter_fn;
  var _ensureNotFinalized;
  var ensureNotFinalized_fn;
  var Muxer = class {
    constructor(options) {
      __privateAdd(this, _validateOptions);
      __privateAdd(this, _writeHeader);
      __privateAdd(this, _computeMoovSizeUpperBound);
      __privateAdd(this, _prepareTracks);
      __privateAdd(this, _generateMpeg4AudioSpecificConfig);
      __privateAdd(this, _createSampleForTrack);
      __privateAdd(this, _addSampleToTrack);
      __privateAdd(this, _validateTimestamp);
      __privateAdd(this, _finalizeCurrentChunk);
      __privateAdd(this, _finalizeFragment);
      __privateAdd(this, _maybeFlushStreamingTargetWriter);
      __privateAdd(this, _ensureNotFinalized);
      __privateAdd(this, _options, void 0);
      __privateAdd(this, _writer, void 0);
      __privateAdd(this, _ftypSize, void 0);
      __privateAdd(this, _mdat, void 0);
      __privateAdd(this, _videoTrack, null);
      __privateAdd(this, _audioTrack, null);
      __privateAdd(this, _creationTime, Math.floor(Date.now() / 1e3) + TIMESTAMP_OFFSET);
      __privateAdd(this, _finalizedChunks, []);
      __privateAdd(this, _nextFragmentNumber, 1);
      __privateAdd(this, _videoSampleQueue, []);
      __privateAdd(this, _audioSampleQueue, []);
      __privateAdd(this, _finalized, false);
      __privateMethod(this, _validateOptions, validateOptions_fn).call(this, options);
      options.video = deepClone(options.video);
      options.audio = deepClone(options.audio);
      options.fastStart = deepClone(options.fastStart);
      this.target = options.target;
      __privateSet(this, _options, {
        firstTimestampBehavior: "strict",
        ...options
      });
      if (options.target instanceof ArrayBufferTarget) {
        __privateSet(this, _writer, new ArrayBufferTargetWriter(options.target));
      } else if (options.target instanceof StreamTarget) {
        __privateSet(this, _writer, new StreamTargetWriter(options.target));
      } else if (options.target instanceof FileSystemWritableFileStreamTarget) {
        __privateSet(this, _writer, new FileSystemWritableFileStreamTargetWriter(options.target));
      } else {
        throw new Error(`Invalid target: ${options.target}`);
      }
      __privateMethod(this, _prepareTracks, prepareTracks_fn).call(this);
      __privateMethod(this, _writeHeader, writeHeader_fn).call(this);
    }
    addVideoChunk(sample, meta, timestamp, compositionTimeOffset) {
      if (!(sample instanceof EncodedVideoChunk)) {
        throw new TypeError("addVideoChunk's first argument (sample) must be of type EncodedVideoChunk.");
      }
      if (meta && typeof meta !== "object") {
        throw new TypeError("addVideoChunk's second argument (meta), when provided, must be an object.");
      }
      if (timestamp !== void 0 && (!Number.isFinite(timestamp) || timestamp < 0)) {
        throw new TypeError(
          "addVideoChunk's third argument (timestamp), when provided, must be a non-negative real number."
        );
      }
      if (compositionTimeOffset !== void 0 && !Number.isFinite(compositionTimeOffset)) {
        throw new TypeError(
          "addVideoChunk's fourth argument (compositionTimeOffset), when provided, must be a real number."
        );
      }
      let data = new Uint8Array(sample.byteLength);
      sample.copyTo(data);
      this.addVideoChunkRaw(
        data,
        sample.type,
        timestamp ?? sample.timestamp,
        sample.duration,
        meta,
        compositionTimeOffset
      );
    }
    addVideoChunkRaw(data, type, timestamp, duration, meta, compositionTimeOffset) {
      if (!(data instanceof Uint8Array)) {
        throw new TypeError("addVideoChunkRaw's first argument (data) must be an instance of Uint8Array.");
      }
      if (type !== "key" && type !== "delta") {
        throw new TypeError("addVideoChunkRaw's second argument (type) must be either 'key' or 'delta'.");
      }
      if (!Number.isFinite(timestamp) || timestamp < 0) {
        throw new TypeError("addVideoChunkRaw's third argument (timestamp) must be a non-negative real number.");
      }
      if (!Number.isFinite(duration) || duration < 0) {
        throw new TypeError("addVideoChunkRaw's fourth argument (duration) must be a non-negative real number.");
      }
      if (meta && typeof meta !== "object") {
        throw new TypeError("addVideoChunkRaw's fifth argument (meta), when provided, must be an object.");
      }
      if (compositionTimeOffset !== void 0 && !Number.isFinite(compositionTimeOffset)) {
        throw new TypeError(
          "addVideoChunkRaw's sixth argument (compositionTimeOffset), when provided, must be a real number."
        );
      }
      __privateMethod(this, _ensureNotFinalized, ensureNotFinalized_fn).call(this);
      if (!__privateGet(this, _options).video)
        throw new Error("No video track declared.");
      if (typeof __privateGet(this, _options).fastStart === "object" && __privateGet(this, _videoTrack).samples.length === __privateGet(this, _options).fastStart.expectedVideoChunks) {
        throw new Error(`Cannot add more video chunks than specified in 'fastStart' (${__privateGet(this, _options).fastStart.expectedVideoChunks}).`);
      }
      let videoSample = __privateMethod(this, _createSampleForTrack, createSampleForTrack_fn).call(this, __privateGet(this, _videoTrack), data, type, timestamp, duration, meta, compositionTimeOffset);
      if (__privateGet(this, _options).fastStart === "fragmented" && __privateGet(this, _audioTrack)) {
        while (__privateGet(this, _audioSampleQueue).length > 0 && __privateGet(this, _audioSampleQueue)[0].decodeTimestamp <= videoSample.decodeTimestamp) {
          let audioSample = __privateGet(this, _audioSampleQueue).shift();
          __privateMethod(this, _addSampleToTrack, addSampleToTrack_fn).call(this, __privateGet(this, _audioTrack), audioSample);
        }
        if (videoSample.decodeTimestamp <= __privateGet(this, _audioTrack).lastDecodeTimestamp) {
          __privateMethod(this, _addSampleToTrack, addSampleToTrack_fn).call(this, __privateGet(this, _videoTrack), videoSample);
        } else {
          __privateGet(this, _videoSampleQueue).push(videoSample);
        }
      } else {
        __privateMethod(this, _addSampleToTrack, addSampleToTrack_fn).call(this, __privateGet(this, _videoTrack), videoSample);
      }
    }
    addAudioChunk(sample, meta, timestamp) {
      if (!(sample instanceof EncodedAudioChunk)) {
        throw new TypeError("addAudioChunk's first argument (sample) must be of type EncodedAudioChunk.");
      }
      if (meta && typeof meta !== "object") {
        throw new TypeError("addAudioChunk's second argument (meta), when provided, must be an object.");
      }
      if (timestamp !== void 0 && (!Number.isFinite(timestamp) || timestamp < 0)) {
        throw new TypeError(
          "addAudioChunk's third argument (timestamp), when provided, must be a non-negative real number."
        );
      }
      let data = new Uint8Array(sample.byteLength);
      sample.copyTo(data);
      this.addAudioChunkRaw(data, sample.type, timestamp ?? sample.timestamp, sample.duration, meta);
    }
    addAudioChunkRaw(data, type, timestamp, duration, meta) {
      if (!(data instanceof Uint8Array)) {
        throw new TypeError("addAudioChunkRaw's first argument (data) must be an instance of Uint8Array.");
      }
      if (type !== "key" && type !== "delta") {
        throw new TypeError("addAudioChunkRaw's second argument (type) must be either 'key' or 'delta'.");
      }
      if (!Number.isFinite(timestamp) || timestamp < 0) {
        throw new TypeError("addAudioChunkRaw's third argument (timestamp) must be a non-negative real number.");
      }
      if (!Number.isFinite(duration) || duration < 0) {
        throw new TypeError("addAudioChunkRaw's fourth argument (duration) must be a non-negative real number.");
      }
      if (meta && typeof meta !== "object") {
        throw new TypeError("addAudioChunkRaw's fifth argument (meta), when provided, must be an object.");
      }
      __privateMethod(this, _ensureNotFinalized, ensureNotFinalized_fn).call(this);
      if (!__privateGet(this, _options).audio)
        throw new Error("No audio track declared.");
      if (typeof __privateGet(this, _options).fastStart === "object" && __privateGet(this, _audioTrack).samples.length === __privateGet(this, _options).fastStart.expectedAudioChunks) {
        throw new Error(`Cannot add more audio chunks than specified in 'fastStart' (${__privateGet(this, _options).fastStart.expectedAudioChunks}).`);
      }
      let audioSample = __privateMethod(this, _createSampleForTrack, createSampleForTrack_fn).call(this, __privateGet(this, _audioTrack), data, type, timestamp, duration, meta);
      if (__privateGet(this, _options).fastStart === "fragmented" && __privateGet(this, _videoTrack)) {
        while (__privateGet(this, _videoSampleQueue).length > 0 && __privateGet(this, _videoSampleQueue)[0].decodeTimestamp <= audioSample.decodeTimestamp) {
          let videoSample = __privateGet(this, _videoSampleQueue).shift();
          __privateMethod(this, _addSampleToTrack, addSampleToTrack_fn).call(this, __privateGet(this, _videoTrack), videoSample);
        }
        if (audioSample.decodeTimestamp <= __privateGet(this, _videoTrack).lastDecodeTimestamp) {
          __privateMethod(this, _addSampleToTrack, addSampleToTrack_fn).call(this, __privateGet(this, _audioTrack), audioSample);
        } else {
          __privateGet(this, _audioSampleQueue).push(audioSample);
        }
      } else {
        __privateMethod(this, _addSampleToTrack, addSampleToTrack_fn).call(this, __privateGet(this, _audioTrack), audioSample);
      }
    }
    /** Finalizes the file, making it ready for use. Must be called after all video and audio chunks have been added. */
    finalize() {
      if (__privateGet(this, _finalized)) {
        throw new Error("Cannot finalize a muxer more than once.");
      }
      if (__privateGet(this, _options).fastStart === "fragmented") {
        for (let videoSample of __privateGet(this, _videoSampleQueue))
          __privateMethod(this, _addSampleToTrack, addSampleToTrack_fn).call(this, __privateGet(this, _videoTrack), videoSample);
        for (let audioSample of __privateGet(this, _audioSampleQueue))
          __privateMethod(this, _addSampleToTrack, addSampleToTrack_fn).call(this, __privateGet(this, _audioTrack), audioSample);
        __privateMethod(this, _finalizeFragment, finalizeFragment_fn).call(this, false);
      } else {
        if (__privateGet(this, _videoTrack))
          __privateMethod(this, _finalizeCurrentChunk, finalizeCurrentChunk_fn).call(this, __privateGet(this, _videoTrack));
        if (__privateGet(this, _audioTrack))
          __privateMethod(this, _finalizeCurrentChunk, finalizeCurrentChunk_fn).call(this, __privateGet(this, _audioTrack));
      }
      let tracks = [__privateGet(this, _videoTrack), __privateGet(this, _audioTrack)].filter(Boolean);
      if (__privateGet(this, _options).fastStart === "in-memory") {
        let mdatSize;
        for (let i = 0; i < 2; i++) {
          let movieBox2 = moov(tracks, __privateGet(this, _creationTime));
          let movieBoxSize = __privateGet(this, _writer).measureBox(movieBox2);
          mdatSize = __privateGet(this, _writer).measureBox(__privateGet(this, _mdat));
          let currentChunkPos = __privateGet(this, _writer).pos + movieBoxSize + mdatSize;
          for (let chunk of __privateGet(this, _finalizedChunks)) {
            chunk.offset = currentChunkPos;
            for (let { data } of chunk.samples) {
              currentChunkPos += data.byteLength;
              mdatSize += data.byteLength;
            }
          }
          if (currentChunkPos < 2 ** 32)
            break;
          if (mdatSize >= 2 ** 32)
            __privateGet(this, _mdat).largeSize = true;
        }
        let movieBox = moov(tracks, __privateGet(this, _creationTime));
        __privateGet(this, _writer).writeBox(movieBox);
        __privateGet(this, _mdat).size = mdatSize;
        __privateGet(this, _writer).writeBox(__privateGet(this, _mdat));
        for (let chunk of __privateGet(this, _finalizedChunks)) {
          for (let sample of chunk.samples) {
            __privateGet(this, _writer).write(sample.data);
            sample.data = null;
          }
        }
      } else if (__privateGet(this, _options).fastStart === "fragmented") {
        let startPos = __privateGet(this, _writer).pos;
        let mfraBox = mfra(tracks);
        __privateGet(this, _writer).writeBox(mfraBox);
        let mfraBoxSize = __privateGet(this, _writer).pos - startPos;
        __privateGet(this, _writer).seek(__privateGet(this, _writer).pos - 4);
        __privateGet(this, _writer).writeU32(mfraBoxSize);
      } else {
        let mdatPos = __privateGet(this, _writer).offsets.get(__privateGet(this, _mdat));
        let mdatSize = __privateGet(this, _writer).pos - mdatPos;
        __privateGet(this, _mdat).size = mdatSize;
        __privateGet(this, _mdat).largeSize = mdatSize >= 2 ** 32;
        __privateGet(this, _writer).patchBox(__privateGet(this, _mdat));
        let movieBox = moov(tracks, __privateGet(this, _creationTime));
        if (typeof __privateGet(this, _options).fastStart === "object") {
          __privateGet(this, _writer).seek(__privateGet(this, _ftypSize));
          __privateGet(this, _writer).writeBox(movieBox);
          let remainingBytes = mdatPos - __privateGet(this, _writer).pos;
          __privateGet(this, _writer).writeBox(free(remainingBytes));
        } else {
          __privateGet(this, _writer).writeBox(movieBox);
        }
      }
      __privateMethod(this, _maybeFlushStreamingTargetWriter, maybeFlushStreamingTargetWriter_fn).call(this);
      __privateGet(this, _writer).finalize();
      __privateSet(this, _finalized, true);
    }
  };
  _options = /* @__PURE__ */ new WeakMap();
  _writer = /* @__PURE__ */ new WeakMap();
  _ftypSize = /* @__PURE__ */ new WeakMap();
  _mdat = /* @__PURE__ */ new WeakMap();
  _videoTrack = /* @__PURE__ */ new WeakMap();
  _audioTrack = /* @__PURE__ */ new WeakMap();
  _creationTime = /* @__PURE__ */ new WeakMap();
  _finalizedChunks = /* @__PURE__ */ new WeakMap();
  _nextFragmentNumber = /* @__PURE__ */ new WeakMap();
  _videoSampleQueue = /* @__PURE__ */ new WeakMap();
  _audioSampleQueue = /* @__PURE__ */ new WeakMap();
  _finalized = /* @__PURE__ */ new WeakMap();
  _validateOptions = /* @__PURE__ */ new WeakSet();
  validateOptions_fn = function(options) {
    if (typeof options !== "object") {
      throw new TypeError("The muxer requires an options object to be passed to its constructor.");
    }
    if (!(options.target instanceof Target)) {
      throw new TypeError("The target must be provided and an instance of Target.");
    }
    if (options.video) {
      if (!SUPPORTED_VIDEO_CODECS.includes(options.video.codec)) {
        throw new TypeError(`Unsupported video codec: ${options.video.codec}`);
      }
      if (!Number.isInteger(options.video.width) || options.video.width <= 0) {
        throw new TypeError(`Invalid video width: ${options.video.width}. Must be a positive integer.`);
      }
      if (!Number.isInteger(options.video.height) || options.video.height <= 0) {
        throw new TypeError(`Invalid video height: ${options.video.height}. Must be a positive integer.`);
      }
      const videoRotation = options.video.rotation;
      if (typeof videoRotation === "number" && ![0, 90, 180, 270].includes(videoRotation)) {
        throw new TypeError(`Invalid video rotation: ${videoRotation}. Has to be 0, 90, 180 or 270.`);
      } else if (Array.isArray(videoRotation) && (videoRotation.length !== 9 || videoRotation.some((value) => typeof value !== "number"))) {
        throw new TypeError(`Invalid video transformation matrix: ${videoRotation.join()}`);
      }
      if (options.video.frameRate !== void 0 && (!Number.isInteger(options.video.frameRate) || options.video.frameRate <= 0)) {
        throw new TypeError(
          `Invalid video frame rate: ${options.video.frameRate}. Must be a positive integer.`
        );
      }
    }
    if (options.audio) {
      if (!SUPPORTED_AUDIO_CODECS.includes(options.audio.codec)) {
        throw new TypeError(`Unsupported audio codec: ${options.audio.codec}`);
      }
      if (!Number.isInteger(options.audio.numberOfChannels) || options.audio.numberOfChannels <= 0) {
        throw new TypeError(
          `Invalid number of audio channels: ${options.audio.numberOfChannels}. Must be a positive integer.`
        );
      }
      if (!Number.isInteger(options.audio.sampleRate) || options.audio.sampleRate <= 0) {
        throw new TypeError(
          `Invalid audio sample rate: ${options.audio.sampleRate}. Must be a positive integer.`
        );
      }
    }
    if (options.firstTimestampBehavior && !FIRST_TIMESTAMP_BEHAVIORS.includes(options.firstTimestampBehavior)) {
      throw new TypeError(`Invalid first timestamp behavior: ${options.firstTimestampBehavior}`);
    }
    if (typeof options.fastStart === "object") {
      if (options.video) {
        if (options.fastStart.expectedVideoChunks === void 0) {
          throw new TypeError(`'fastStart' is an object but is missing property 'expectedVideoChunks'.`);
        } else if (!Number.isInteger(options.fastStart.expectedVideoChunks) || options.fastStart.expectedVideoChunks < 0) {
          throw new TypeError(`'expectedVideoChunks' must be a non-negative integer.`);
        }
      }
      if (options.audio) {
        if (options.fastStart.expectedAudioChunks === void 0) {
          throw new TypeError(`'fastStart' is an object but is missing property 'expectedAudioChunks'.`);
        } else if (!Number.isInteger(options.fastStart.expectedAudioChunks) || options.fastStart.expectedAudioChunks < 0) {
          throw new TypeError(`'expectedAudioChunks' must be a non-negative integer.`);
        }
      }
    } else if (![false, "in-memory", "fragmented"].includes(options.fastStart)) {
      throw new TypeError(`'fastStart' option must be false, 'in-memory', 'fragmented' or an object.`);
    }
    if (options.minFragmentDuration !== void 0 && (!Number.isFinite(options.minFragmentDuration) || options.minFragmentDuration < 0)) {
      throw new TypeError(`'minFragmentDuration' must be a non-negative number.`);
    }
  };
  _writeHeader = /* @__PURE__ */ new WeakSet();
  writeHeader_fn = function() {
    __privateGet(this, _writer).writeBox(ftyp({
      holdsAvc: __privateGet(this, _options).video?.codec === "avc",
      fragmented: __privateGet(this, _options).fastStart === "fragmented"
    }));
    __privateSet(this, _ftypSize, __privateGet(this, _writer).pos);
    if (__privateGet(this, _options).fastStart === "in-memory") {
      __privateSet(this, _mdat, mdat(false));
    } else if (__privateGet(this, _options).fastStart === "fragmented") {
    } else {
      if (typeof __privateGet(this, _options).fastStart === "object") {
        let moovSizeUpperBound = __privateMethod(this, _computeMoovSizeUpperBound, computeMoovSizeUpperBound_fn).call(this);
        __privateGet(this, _writer).seek(__privateGet(this, _writer).pos + moovSizeUpperBound);
      }
      __privateSet(this, _mdat, mdat(true));
      __privateGet(this, _writer).writeBox(__privateGet(this, _mdat));
    }
    __privateMethod(this, _maybeFlushStreamingTargetWriter, maybeFlushStreamingTargetWriter_fn).call(this);
  };
  _computeMoovSizeUpperBound = /* @__PURE__ */ new WeakSet();
  computeMoovSizeUpperBound_fn = function() {
    if (typeof __privateGet(this, _options).fastStart !== "object")
      return;
    let upperBound = 0;
    let sampleCounts = [
      __privateGet(this, _options).fastStart.expectedVideoChunks,
      __privateGet(this, _options).fastStart.expectedAudioChunks
    ];
    for (let n of sampleCounts) {
      if (!n)
        continue;
      upperBound += (4 + 4) * Math.ceil(2 / 3 * n);
      upperBound += 4 * n;
      upperBound += (4 + 4 + 4) * Math.ceil(2 / 3 * n);
      upperBound += 4 * n;
      upperBound += 8 * n;
    }
    upperBound += 4096;
    return upperBound;
  };
  _prepareTracks = /* @__PURE__ */ new WeakSet();
  prepareTracks_fn = function() {
    if (__privateGet(this, _options).video) {
      __privateSet(this, _videoTrack, {
        id: 1,
        info: {
          type: "video",
          codec: __privateGet(this, _options).video.codec,
          width: __privateGet(this, _options).video.width,
          height: __privateGet(this, _options).video.height,
          rotation: __privateGet(this, _options).video.rotation ?? 0,
          decoderConfig: null
        },
        // The fallback contains many common frame rates as factors
        timescale: __privateGet(this, _options).video.frameRate ?? 57600,
        samples: [],
        finalizedChunks: [],
        currentChunk: null,
        firstDecodeTimestamp: void 0,
        lastDecodeTimestamp: -1,
        timeToSampleTable: [],
        compositionTimeOffsetTable: [],
        lastTimescaleUnits: null,
        lastSample: null,
        compactlyCodedChunkTable: []
      });
    }
    if (__privateGet(this, _options).audio) {
      __privateSet(this, _audioTrack, {
        id: __privateGet(this, _options).video ? 2 : 1,
        info: {
          type: "audio",
          codec: __privateGet(this, _options).audio.codec,
          numberOfChannels: __privateGet(this, _options).audio.numberOfChannels,
          sampleRate: __privateGet(this, _options).audio.sampleRate,
          decoderConfig: null
        },
        timescale: __privateGet(this, _options).audio.sampleRate,
        samples: [],
        finalizedChunks: [],
        currentChunk: null,
        firstDecodeTimestamp: void 0,
        lastDecodeTimestamp: -1,
        timeToSampleTable: [],
        compositionTimeOffsetTable: [],
        lastTimescaleUnits: null,
        lastSample: null,
        compactlyCodedChunkTable: []
      });
      if (__privateGet(this, _options).audio.codec === "aac") {
        let guessedCodecPrivate = __privateMethod(this, _generateMpeg4AudioSpecificConfig, generateMpeg4AudioSpecificConfig_fn).call(
          this,
          2,
          // Object type for AAC-LC, since it's the most common
          __privateGet(this, _options).audio.sampleRate,
          __privateGet(this, _options).audio.numberOfChannels
        );
        __privateGet(this, _audioTrack).info.decoderConfig = {
          codec: __privateGet(this, _options).audio.codec,
          description: guessedCodecPrivate,
          numberOfChannels: __privateGet(this, _options).audio.numberOfChannels,
          sampleRate: __privateGet(this, _options).audio.sampleRate
        };
      }
    }
  };
  _generateMpeg4AudioSpecificConfig = /* @__PURE__ */ new WeakSet();
  generateMpeg4AudioSpecificConfig_fn = function(objectType, sampleRate, numberOfChannels) {
    let frequencyIndices = [96e3, 88200, 64e3, 48e3, 44100, 32e3, 24e3, 22050, 16e3, 12e3, 11025, 8e3, 7350];
    let frequencyIndex = frequencyIndices.indexOf(sampleRate);
    let channelConfig = numberOfChannels;
    let configBits = "";
    configBits += objectType.toString(2).padStart(5, "0");
    configBits += frequencyIndex.toString(2).padStart(4, "0");
    if (frequencyIndex === 15)
      configBits += sampleRate.toString(2).padStart(24, "0");
    configBits += channelConfig.toString(2).padStart(4, "0");
    let paddingLength = Math.ceil(configBits.length / 8) * 8;
    configBits = configBits.padEnd(paddingLength, "0");
    let configBytes = new Uint8Array(configBits.length / 8);
    for (let i = 0; i < configBits.length; i += 8) {
      configBytes[i / 8] = parseInt(configBits.slice(i, i + 8), 2);
    }
    return configBytes;
  };
  _createSampleForTrack = /* @__PURE__ */ new WeakSet();
  createSampleForTrack_fn = function(track, data, type, timestamp, duration, meta, compositionTimeOffset) {
    let presentationTimestampInSeconds = timestamp / 1e6;
    let decodeTimestampInSeconds = (timestamp - (compositionTimeOffset ?? 0)) / 1e6;
    let durationInSeconds = duration / 1e6;
    let adjusted = __privateMethod(this, _validateTimestamp, validateTimestamp_fn).call(this, presentationTimestampInSeconds, decodeTimestampInSeconds, track);
    presentationTimestampInSeconds = adjusted.presentationTimestamp;
    decodeTimestampInSeconds = adjusted.decodeTimestamp;
    if (meta?.decoderConfig) {
      if (track.info.decoderConfig === null) {
        track.info.decoderConfig = meta.decoderConfig;
      } else {
        Object.assign(track.info.decoderConfig, meta.decoderConfig);
      }
    }
    let sample = {
      presentationTimestamp: presentationTimestampInSeconds,
      decodeTimestamp: decodeTimestampInSeconds,
      duration: durationInSeconds,
      data,
      size: data.byteLength,
      type,
      // Will be refined once the next sample comes in
      timescaleUnitsToNextSample: intoTimescale(durationInSeconds, track.timescale)
    };
    return sample;
  };
  _addSampleToTrack = /* @__PURE__ */ new WeakSet();
  addSampleToTrack_fn = function(track, sample) {
    if (__privateGet(this, _options).fastStart !== "fragmented") {
      track.samples.push(sample);
    }
    const sampleCompositionTimeOffset = intoTimescale(sample.presentationTimestamp - sample.decodeTimestamp, track.timescale);
    if (track.lastTimescaleUnits !== null) {
      let timescaleUnits = intoTimescale(sample.decodeTimestamp, track.timescale, false);
      let delta = Math.round(timescaleUnits - track.lastTimescaleUnits);
      track.lastTimescaleUnits += delta;
      track.lastSample.timescaleUnitsToNextSample = delta;
      if (__privateGet(this, _options).fastStart !== "fragmented") {
        let lastTableEntry = last(track.timeToSampleTable);
        if (lastTableEntry.sampleCount === 1) {
          lastTableEntry.sampleDelta = delta;
          lastTableEntry.sampleCount++;
        } else if (lastTableEntry.sampleDelta === delta) {
          lastTableEntry.sampleCount++;
        } else {
          lastTableEntry.sampleCount--;
          track.timeToSampleTable.push({
            sampleCount: 2,
            sampleDelta: delta
          });
        }
        const lastCompositionTimeOffsetTableEntry = last(track.compositionTimeOffsetTable);
        if (lastCompositionTimeOffsetTableEntry.sampleCompositionTimeOffset === sampleCompositionTimeOffset) {
          lastCompositionTimeOffsetTableEntry.sampleCount++;
        } else {
          track.compositionTimeOffsetTable.push({
            sampleCount: 1,
            sampleCompositionTimeOffset
          });
        }
      }
    } else {
      track.lastTimescaleUnits = 0;
      if (__privateGet(this, _options).fastStart !== "fragmented") {
        track.timeToSampleTable.push({
          sampleCount: 1,
          sampleDelta: intoTimescale(sample.duration, track.timescale)
        });
        track.compositionTimeOffsetTable.push({
          sampleCount: 1,
          sampleCompositionTimeOffset
        });
      }
    }
    track.lastSample = sample;
    let beginNewChunk = false;
    if (!track.currentChunk) {
      beginNewChunk = true;
    } else {
      let currentChunkDuration = sample.presentationTimestamp - track.currentChunk.startTimestamp;
      if (__privateGet(this, _options).fastStart === "fragmented") {
        let mostImportantTrack = __privateGet(this, _videoTrack) ?? __privateGet(this, _audioTrack);
        const chunkDuration = __privateGet(this, _options).minFragmentDuration ?? 1;
        if (track === mostImportantTrack && sample.type === "key" && currentChunkDuration >= chunkDuration) {
          beginNewChunk = true;
          __privateMethod(this, _finalizeFragment, finalizeFragment_fn).call(this);
        }
      } else {
        beginNewChunk = currentChunkDuration >= 0.5;
      }
    }
    if (beginNewChunk) {
      if (track.currentChunk) {
        __privateMethod(this, _finalizeCurrentChunk, finalizeCurrentChunk_fn).call(this, track);
      }
      track.currentChunk = {
        startTimestamp: sample.presentationTimestamp,
        samples: []
      };
    }
    track.currentChunk.samples.push(sample);
  };
  _validateTimestamp = /* @__PURE__ */ new WeakSet();
  validateTimestamp_fn = function(presentationTimestamp, decodeTimestamp, track) {
    const strictTimestampBehavior = __privateGet(this, _options).firstTimestampBehavior === "strict";
    const noLastDecodeTimestamp = track.lastDecodeTimestamp === -1;
    const timestampNonZero = decodeTimestamp !== 0;
    if (strictTimestampBehavior && noLastDecodeTimestamp && timestampNonZero) {
      throw new Error(
        `The first chunk for your media track must have a timestamp of 0 (received DTS=${decodeTimestamp}).Non-zero first timestamps are often caused by directly piping frames or audio data from a MediaStreamTrack into the encoder. Their timestamps are typically relative to the age of thedocument, which is probably what you want.

If you want to offset all timestamps of a track such that the first one is zero, set firstTimestampBehavior: 'offset' in the options.
`
      );
    } else if (__privateGet(this, _options).firstTimestampBehavior === "offset" || __privateGet(this, _options).firstTimestampBehavior === "cross-track-offset") {
      if (track.firstDecodeTimestamp === void 0) {
        track.firstDecodeTimestamp = decodeTimestamp;
      }
      let baseDecodeTimestamp;
      if (__privateGet(this, _options).firstTimestampBehavior === "offset") {
        baseDecodeTimestamp = track.firstDecodeTimestamp;
      } else {
        baseDecodeTimestamp = Math.min(
          __privateGet(this, _videoTrack)?.firstDecodeTimestamp ?? Infinity,
          __privateGet(this, _audioTrack)?.firstDecodeTimestamp ?? Infinity
        );
      }
      decodeTimestamp -= baseDecodeTimestamp;
      presentationTimestamp -= baseDecodeTimestamp;
    }
    if (decodeTimestamp < track.lastDecodeTimestamp) {
      throw new Error(
        `Timestamps must be monotonically increasing (DTS went from ${track.lastDecodeTimestamp * 1e6} to ${decodeTimestamp * 1e6}).`
      );
    }
    track.lastDecodeTimestamp = decodeTimestamp;
    return { presentationTimestamp, decodeTimestamp };
  };
  _finalizeCurrentChunk = /* @__PURE__ */ new WeakSet();
  finalizeCurrentChunk_fn = function(track) {
    if (__privateGet(this, _options).fastStart === "fragmented") {
      throw new Error("Can't finalize individual chunks if 'fastStart' is set to 'fragmented'.");
    }
    if (!track.currentChunk)
      return;
    track.finalizedChunks.push(track.currentChunk);
    __privateGet(this, _finalizedChunks).push(track.currentChunk);
    if (track.compactlyCodedChunkTable.length === 0 || last(track.compactlyCodedChunkTable).samplesPerChunk !== track.currentChunk.samples.length) {
      track.compactlyCodedChunkTable.push({
        firstChunk: track.finalizedChunks.length,
        // 1-indexed
        samplesPerChunk: track.currentChunk.samples.length
      });
    }
    if (__privateGet(this, _options).fastStart === "in-memory") {
      track.currentChunk.offset = 0;
      return;
    }
    track.currentChunk.offset = __privateGet(this, _writer).pos;
    for (let sample of track.currentChunk.samples) {
      __privateGet(this, _writer).write(sample.data);
      sample.data = null;
    }
    __privateMethod(this, _maybeFlushStreamingTargetWriter, maybeFlushStreamingTargetWriter_fn).call(this);
  };
  _finalizeFragment = /* @__PURE__ */ new WeakSet();
  finalizeFragment_fn = function(flushStreamingWriter = true) {
    if (__privateGet(this, _options).fastStart !== "fragmented") {
      throw new Error("Can't finalize a fragment unless 'fastStart' is set to 'fragmented'.");
    }
    let tracks = [__privateGet(this, _videoTrack), __privateGet(this, _audioTrack)].filter((track) => track && track.currentChunk);
    if (tracks.length === 0)
      return;
    let fragmentNumber = __privateWrapper(this, _nextFragmentNumber)._++;
    if (fragmentNumber === 1) {
      let movieBox = moov(tracks, __privateGet(this, _creationTime), true);
      __privateGet(this, _writer).writeBox(movieBox);
    }
    let moofOffset = __privateGet(this, _writer).pos;
    let moofBox = moof(fragmentNumber, tracks);
    __privateGet(this, _writer).writeBox(moofBox);
    {
      let mdatBox = mdat(false);
      let totalTrackSampleSize = 0;
      for (let track of tracks) {
        for (let sample of track.currentChunk.samples) {
          totalTrackSampleSize += sample.size;
        }
      }
      let mdatSize = __privateGet(this, _writer).measureBox(mdatBox) + totalTrackSampleSize;
      if (mdatSize >= 2 ** 32) {
        mdatBox.largeSize = true;
        mdatSize = __privateGet(this, _writer).measureBox(mdatBox) + totalTrackSampleSize;
      }
      mdatBox.size = mdatSize;
      __privateGet(this, _writer).writeBox(mdatBox);
    }
    for (let track of tracks) {
      track.currentChunk.offset = __privateGet(this, _writer).pos;
      track.currentChunk.moofOffset = moofOffset;
      for (let sample of track.currentChunk.samples) {
        __privateGet(this, _writer).write(sample.data);
        sample.data = null;
      }
    }
    let endPos = __privateGet(this, _writer).pos;
    __privateGet(this, _writer).seek(__privateGet(this, _writer).offsets.get(moofBox));
    let newMoofBox = moof(fragmentNumber, tracks);
    __privateGet(this, _writer).writeBox(newMoofBox);
    __privateGet(this, _writer).seek(endPos);
    for (let track of tracks) {
      track.finalizedChunks.push(track.currentChunk);
      __privateGet(this, _finalizedChunks).push(track.currentChunk);
      track.currentChunk = null;
    }
    if (flushStreamingWriter) {
      __privateMethod(this, _maybeFlushStreamingTargetWriter, maybeFlushStreamingTargetWriter_fn).call(this);
    }
  };
  _maybeFlushStreamingTargetWriter = /* @__PURE__ */ new WeakSet();
  maybeFlushStreamingTargetWriter_fn = function() {
    if (__privateGet(this, _writer) instanceof StreamTargetWriter) {
      __privateGet(this, _writer).flush();
    }
  };
  _ensureNotFinalized = /* @__PURE__ */ new WeakSet();
  ensureNotFinalized_fn = function() {
    if (__privateGet(this, _finalized)) {
      throw new Error("Cannot add new video or audio chunks after the file has been finalized.");
    }
  };

  // tools/promo/scene/camera.js
  var WINDOW = { width: 1440, height: 940 };
  var FRAME = { width: 1920, height: 1080 };
  var PARK_DISTANCE = 1440;
  var PARK_HEIGHT = 0.84;
  var FOCAL = PARK_HEIGHT * FRAME.height * PARK_DISTANCE / WINDOW.height;
  var STRIPS = 64;
  var EASINGS = {
    smooth: (t) => t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2,
    out: (t) => 1 - (1 - t) ** 3,
    in: (t) => t * t * t,
    linear: (t) => t,
    backOut: (t) => {
      const c1 = 1.70158;
      const c3 = c1 + 1;
      return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
    }
  };
  function ease(name, t) {
    const fn = EASINGS[name] ?? EASINGS.smooth;
    return fn(Math.max(0, Math.min(1, t)));
  }
  function lerpPose(a, b, t) {
    const keys = ["x", "y", "z", "rotX", "rotY", "rotZ", "glow"];
    const out = {};
    for (const key of keys) out[key] = (a[key] ?? 0) + ((b[key] ?? 0) - (a[key] ?? 0)) * t;
    out.opacity = (a.opacity ?? 1) + ((b.opacity ?? 1) - (a.opacity ?? 1)) * t;
    return out;
  }
  function poseAt(shots, time) {
    if (!shots.length) return { x: 0, y: 0, z: PARK_DISTANCE, rotX: 0, rotY: 0, rotZ: 0, glow: 0, opacity: 1 };
    let current = shots[0];
    for (const shot of shots) if (time >= shot.start) current = shot;
    const index = shots.indexOf(current);
    const next = shots[index + 1];
    const span = next ? next.start - current.start : current.end - current.start;
    const t = ease(current.ease ?? "smooth", (time - current.start) / span);
    return next ? lerpPose(current, next, t) : { ...current };
  }
  function breathe(time) {
    return {
      dz: Math.sin(time / 12 * Math.PI * 2) * 6e-3,
      dx: Math.sin(time / 17 * Math.PI * 2) * 3,
      dy: Math.cos(time / 21 * Math.PI * 2) * 2.5,
      roll: Math.sin(time / 26 * Math.PI * 2) * 0.12
    };
  }
  function projectQuad(pose, time, opts = {}) {
    const b = opts.breathe === false ? { dz: 0, dx: 0, dy: 0, roll: 0 } : breathe(time);
    const hw = WINDOW.width / 2;
    const hh = WINDOW.height / 2;
    const distance = Math.max(360, pose.z * (1 + b.dz));
    const yaw = (pose.rotY ?? 0) * Math.PI / 180;
    const pitch = (pose.rotX ?? 0) * Math.PI / 180;
    const roll = ((pose.rotZ ?? 0) + b.roll) * Math.PI / 180;
    const cosY = Math.cos(yaw);
    const sinY = Math.sin(yaw);
    const cosP = Math.cos(pitch);
    const sinP = Math.sin(pitch);
    const cosR = Math.cos(roll);
    const sinR = Math.sin(roll);
    const project = (px, py) => {
      const x1 = px * cosY;
      const z1 = -px * sinY;
      const y1 = py * cosP - z1 * sinP;
      const z2 = py * sinP + z1 * cosP;
      const x2 = x1 * cosR - y1 * sinR;
      const y2 = x1 * sinR + y1 * cosR;
      const zCamera = Math.max(120, distance + z2);
      const scale = FOCAL / zCamera;
      return {
        x: FRAME.width / 2 + x2 * scale + pose.x + b.dx,
        y: FRAME.height / 2 + y2 * scale + pose.y + b.dy
      };
    };
    return [project(-hw, -hh), project(hw, -hh), project(hw, hh), project(-hw, hh)];
  }
  function drawQuad(ctx, source, quad, alpha = 1) {
    if (alpha <= 4e-3) return;
    const [tl, tr, br, bl] = quad;
    const sourceHeight = source.height;
    const stripSource = sourceHeight / STRIPS;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    for (let i = 0; i < STRIPS; i += 1) {
      const f0 = i / STRIPS;
      const f1 = (i + 1) / STRIPS;
      const l0x = tl.x + (bl.x - tl.x) * f0;
      const l0y = tl.y + (bl.y - tl.y) * f0;
      const l1x = tl.x + (bl.x - tl.x) * f1;
      const l1y = tl.y + (bl.y - tl.y) * f1;
      const r0x = tr.x + (br.x - tr.x) * f0;
      const r0y = tr.y + (br.y - tr.y) * f0;
      const r1x = tr.x + (br.x - tr.x) * f1;
      const r1y = tr.y + (br.y - tr.y) * f1;
      const sy0 = i * stripSource;
      const sh = Math.min(stripSource + 1, sourceHeight - sy0);
      if (sh <= 0) continue;
      const a = (r0x - l0x) / WINDOW.width;
      const e = l0x;
      const b = (r0y - l0y) / WINDOW.width;
      const d = (l1y - l0y) / stripSource;
      const f = l0y;
      ctx.save();
      ctx.setTransform(a, b, 0, d, e, f);
      ctx.drawImage(source, 0, sy0, WINDOW.width, sh, 0, 0, WINDOW.width, sh);
      ctx.restore();
    }
    ctx.restore();
  }
  function quadBounds(quad) {
    const xs = quad.map((p) => p.x);
    const ys = quad.map((p) => p.y);
    const left = Math.min(...xs);
    const top = Math.min(...ys);
    return { left, top, width: Math.max(...xs) - left, height: Math.max(...ys) - top };
  }

  // tools/promo/scene/theme.js
  var LIGHT = {
    bg: "rgb(255,255,255)",
    panel: "rgb(255,255,255)",
    sidebar: "rgb(240,243,249)",
    surface: "rgb(255,255,255)",
    text: "rgb(26,28,31)",
    muted: "rgba(26,28,31,.65)",
    tertiary: "rgba(26,28,31,.494)",
    hover: "rgba(26,28,31,.055)",
    selected: "rgba(26,28,31,.05)",
    border: "rgba(26,28,31,.08)",
    borderStrong: "rgba(26,28,31,.118)",
    accent: "rgb(44,103,197)",
    accentSoft: "rgba(44,103,197,.15)",
    danger: "rgb(186,38,35)",
    success: "rgb(0,162,64)",
    diffAdded: "rgba(0,162,64,.15)",
    diffRemoved: "rgba(186,38,35,.15)",
    codeBg: "rgba(26,28,31,.04)",
    // The user bubble is a near-black pill in both themes.
    bubble: "rgb(26,28,31)",
    bubbleText: "rgb(255,255,255)",
    shadow: "rgba(0,0,0,.14)",
    isDark: false
  };
  var DARK = {
    bg: "rgb(24,24,24)",
    panel: "rgb(24,24,24)",
    sidebar: "rgb(29,32,38)",
    surface: "rgb(45,45,45)",
    text: "rgb(255,255,255)",
    muted: "rgba(255,255,255,.65)",
    tertiary: "rgba(255,255,255,.498)",
    hover: "rgba(255,255,255,.08)",
    selected: "rgba(255,255,255,.05)",
    border: "rgba(255,255,255,.082)",
    borderStrong: "rgba(255,255,255,.157)",
    accent: "rgb(131,195,255)",
    accentSoft: "rgba(131,195,255,.15)",
    danger: "rgb(250,66,62)",
    success: "rgb(64,201,119)",
    diffAdded: "rgba(64,201,119,.23)",
    diffRemoved: "rgba(250,66,62,.23)",
    codeBg: "rgba(255,255,255,.06)",
    bubble: "rgb(255,255,255)",
    bubbleText: "rgb(24,24,24)",
    shadow: "rgba(0,0,0,.5)",
    isDark: true
  };
  var TYPE = {
    sans: '"Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif',
    mono: 'Consolas, "Cascadia Code", ui-monospace, monospace',
    serif: 'Georgia, "Times New Roman", serif',
    ui: 14,
    uiSmall: 13,
    uiWeight: 430
  };
  var GEOMETRY = {
    toolbar: 46,
    sidebar: 275,
    review: 390,
    row: 31,
    rowNav: 30,
    radiusRow: 10,
    radiusComposer: 22
  };

  // tools/promo/scene/ui.js
  var CONVERSATION = {
    threadTitle: "\u6574\u7406\u793A\u4F8B\u9879\u76EE\u6587\u6863",
    project: "\u793A\u4F8B\u9879\u76EE",
    userTurns: ["\u8BF7\u9605\u8BFB README\uFF0C\u5E76\u8865\u5145\u5B89\u88C5\u6B65\u9AA4\u3002", "\u518D\u52A0\u4E00\u4E2A hello \u793A\u4F8B\u3002"],
    assistantTurns: [
      "\u6211\u5148\u770B\u4E00\u4E0B\u9879\u76EE\u7ED3\u6784\u3002",
      "\u5DF2\u5B8C\u6210\u3002\n\n- README \u589E\u52A0\u4E86\u5B89\u88C5\u6B65\u9AA4\n- \u65B0\u5EFA\u4E86 `hello.txt`\n- \u53F3\u4FA7 Review \u53EF\u4EE5\u770B\u5230\u4E24\u5904\u5DEE\u5F02"
    ],
    thinking: "\u9700\u8981\u786E\u8BA4 README \u7684\u73B0\u6709\u7AE0\u8282\u5C42\u7EA7\u3002",
    tools: [
      { name: "read", args: '{"path":"README.md"}', output: "# \u793A\u4F8B\u9879\u76EE" },
      { name: "powershell", args: '{"command":"Set-Content hello.txt"}', output: "DESKTOP_COMMAND_OK" }
    ],
    notice: "\u4E0A\u4E0B\u6587\u5DF2\u538B\u7F29\u3002",
    plan: [
      { text: "\u9605\u8BFB README", status: "completed" },
      { text: "\u8865\u5145\u5B89\u88C5\u6B65\u9AA4", status: "in_progress" }
    ],
    navItems: ["\u65B0\u5EFA\u804A\u5929", "\u5F85\u5BA1\u9605", "\u81EA\u52A8\u5316", "Skills \u4E0E\u6269\u5C55"],
    threads: ["\u6574\u7406\u793A\u4F8B\u9879\u76EE\u6587\u6863", "\u91CD\u6784\u65E5\u5FD7\u6A21\u5757", "\u4FEE\u590D\u7EC8\u7AEF\u95EA\u70C1", "\u6574\u7406\u6A21\u578B\u914D\u7F6E", "\u8865\u5145\u7AEF\u5230\u7AEF\u6D4B\u8BD5", "\u8BBE\u8BA1\u63D2\u4EF6\u52A0\u8F7D\u6D41\u7A0B"]
  };
  var SIDEBAR_ROWS = [
    { kind: "nav", label: "\u65B0\u5EFA\u804A\u5929", hint: "Ctrl N" },
    { kind: "nav", label: "\u5F85\u5BA1\u9605" },
    { kind: "nav", label: "\u81EA\u52A8\u5316" },
    { kind: "nav", label: "Skills \u4E0E\u6269\u5C55" }
  ];
  function initialState() {
    return {
      view: "home",
      // 'home' | 'workbench' | 'settings' | 'terminal' | 'palette'
      revealUser: 1,
      // how much of the transcript is visible, 0..1
      typed: "",
      // composer text being typed
      toolOpen: 0,
      // 0..1 expansion of the first tool card
      diffOpen: 0,
      // 0..1 expansion of the README diff
      reviewTab: "changes",
      // 'changes' | 'plan'
      reviewOpen: true,
      sidebarOpen: true,
      planProgress: 0,
      // 0..1 of the second plan step
      terminalLines: 3,
      paletteQuery: "",
      streamText: ""
      // partial assistant text while it streams
    };
  }
  function roundRect(ctx, x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  }
  function fillRound(ctx, x, y, w, h, r, color) {
    ctx.fillStyle = color;
    roundRect(ctx, x, y, w, h, r);
    ctx.fill();
  }
  function text(ctx, value, x, y, opts = {}) {
    const font = opts.font ?? `${TYPE.uiWeight} ${TYPE.ui}px ${TYPE.sans}`;
    ctx.font = font;
    ctx.fillStyle = opts.color ?? "#000";
    ctx.textAlign = opts.align ?? "left";
    ctx.textBaseline = opts.baseline ?? "middle";
    if (opts.maxWidth) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x - (opts.align === "right" ? opts.maxWidth : 0), y - 20, opts.maxWidth, 40);
      ctx.clip();
      ctx.fillText(value, x, y);
      ctx.restore();
    } else {
      ctx.fillText(value, x, y);
    }
    return ctx.measureText(value).width;
  }
  function icon(ctx, name, x, y, size, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const s = size / 16;
    ctx.scale(s, s);
    ctx.beginPath();
    switch (name) {
      case "chat":
        ctx.moveTo(-6, -5);
        ctx.lineTo(6, -5);
        ctx.lineTo(6, 3);
        ctx.lineTo(1, 3);
        ctx.lineTo(-2, 6);
        ctx.lineTo(-2, 3);
        ctx.lineTo(-6, 3);
        ctx.closePath();
        break;
      case "inbox":
        ctx.moveTo(-6, -5);
        ctx.lineTo(6, -5);
        ctx.lineTo(6, 5);
        ctx.lineTo(-6, 5);
        ctx.closePath();
        ctx.moveTo(-6, 1);
        ctx.lineTo(-2, 1);
        ctx.lineTo(-1, 3);
        ctx.lineTo(1, 3);
        ctx.lineTo(2, 1);
        ctx.lineTo(6, 1);
        break;
      case "zap":
        ctx.moveTo(2, -7);
        ctx.lineTo(-4, 0);
        ctx.lineTo(0, 0);
        ctx.lineTo(-2, 7);
        ctx.lineTo(4, -1);
        ctx.lineTo(0, -1);
        ctx.closePath();
        break;
      case "layers":
        ctx.moveTo(0, -6);
        ctx.lineTo(6, -2.5);
        ctx.lineTo(0, 1);
        ctx.lineTo(-6, -2.5);
        ctx.closePath();
        ctx.moveTo(-6, 1.5);
        ctx.lineTo(0, 5);
        ctx.lineTo(6, 1.5);
        ctx.moveTo(-6, 4.5);
        ctx.lineTo(0, 8);
        ctx.lineTo(6, 4.5);
        break;
      case "folder":
        ctx.moveTo(-6, -4);
        ctx.lineTo(-2, -4);
        ctx.lineTo(-0.5, -2);
        ctx.lineTo(6, -2);
        ctx.lineTo(6, 5);
        ctx.lineTo(-6, 5);
        ctx.closePath();
        break;
      case "search":
        ctx.arc(-1, -1, 4.5, 0, Math.PI * 2);
        ctx.moveTo(2.5, 2.5);
        ctx.lineTo(6, 6);
        break;
      case "branch":
        ctx.arc(-3, -4, 2, 0, Math.PI * 2);
        ctx.arc(-3, 4, 2, 0, Math.PI * 2);
        ctx.moveTo(-3, -2);
        ctx.lineTo(-3, 2);
        ctx.moveTo(-1, -4);
        ctx.quadraticCurveTo(4, -4, 4, 0);
        ctx.quadraticCurveTo(4, 3, 1, 3);
        break;
      case "chevron":
        ctx.moveTo(-3, -2);
        ctx.lineTo(0, 1.5);
        ctx.lineTo(3, -2);
        break;
      case "plus":
        ctx.moveTo(0, -5);
        ctx.lineTo(0, 5);
        ctx.moveTo(-5, 0);
        ctx.lineTo(5, 0);
        break;
      case "send":
        ctx.moveTo(0, -5);
        ctx.lineTo(0, 4);
        ctx.moveTo(-4, 0);
        ctx.lineTo(0, -5);
        ctx.lineTo(4, 0);
        break;
      case "panel":
        ctx.moveTo(-6, -5);
        ctx.lineTo(6, -5);
        ctx.lineTo(6, 5);
        ctx.lineTo(-6, 5);
        ctx.closePath();
        ctx.moveTo(1, -5);
        ctx.lineTo(1, 5);
        break;
      case "list":
        ctx.moveTo(-5, -4);
        ctx.lineTo(6, -4);
        ctx.moveTo(-5, 0);
        ctx.lineTo(6, 0);
        ctx.moveTo(-5, 4);
        ctx.lineTo(6, 4);
        ctx.moveTo(-6.5, -4);
        ctx.lineTo(-6.5, -4.01);
        ctx.moveTo(-6.5, 0);
        ctx.lineTo(-6.5, 0.01);
        ctx.moveTo(-6.5, 4);
        ctx.lineTo(-6.5, 4.01);
        break;
      case "dots":
        for (const dx of [-5, 0, 5]) {
          ctx.moveTo(dx, 0);
          ctx.lineTo(dx + 0.01, 0);
        }
        ctx.lineWidth = 2.2;
        break;
      case "check":
        ctx.moveTo(-5, 0);
        ctx.lineTo(-1.5, 3.5);
        ctx.lineTo(5, -3.5);
        break;
      case "circle":
        ctx.arc(0, 0, 5.5, 0, Math.PI * 2);
        break;
      case "dot":
        ctx.arc(0, 0, 3, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        break;
      case "shield":
        ctx.moveTo(0, -6);
        ctx.lineTo(5, -3.5);
        ctx.lineTo(5, 1);
        ctx.quadraticCurveTo(5, 5, 0, 6.5);
        ctx.quadraticCurveTo(-5, 5, -5, 1);
        ctx.lineTo(-5, -3.5);
        ctx.closePath();
        break;
      case "settings":
        ctx.arc(0, 0, 2.5, 0, Math.PI * 2);
        ctx.moveTo(0, -6.5);
        ctx.lineTo(0, -4);
        ctx.moveTo(0, 6.5);
        ctx.lineTo(0, 4);
        ctx.moveTo(-6.5, 0);
        ctx.lineTo(-4, 0);
        ctx.moveTo(6.5, 0);
        ctx.lineTo(4, 0);
        break;
      default:
        ctx.arc(0, 0, 5, 0, Math.PI * 2);
    }
    ctx.stroke();
    ctx.restore();
  }
  function markdown(ctx, value, x, y, width, theme, lineHeight = 26, size = TYPE.ui) {
    const lines = value.split("\n");
    let cursor = y;
    for (const line of lines) {
      if (line.trim() === "") {
        cursor += lineHeight * 0.45;
        continue;
      }
      const bullet = line.startsWith("- ");
      const body = bullet ? line.slice(2) : line;
      let textX = x;
      if (bullet) {
        ctx.fillStyle = theme.text;
        ctx.beginPath();
        ctx.arc(x + 4, cursor, 2.4, 0, Math.PI * 2);
        ctx.fill();
        textX = x + 18;
      }
      const parts = body.split(/(`[^`]+`)/g).filter(Boolean);
      let px = textX;
      for (const part of parts) {
        const isCode = part.startsWith("`") && part.endsWith("`");
        const content = isCode ? part.slice(1, -1) : part;
        const font = isCode ? `${size}px ${TYPE.mono}` : `${TYPE.uiWeight} ${size}px ${TYPE.sans}`;
        ctx.font = font;
        const w = ctx.measureText(content).width;
        if (isCode) fillRound(ctx, px - 3, cursor - 11, w + 6, 22, 5, theme.codeBg);
        ctx.fillStyle = theme.text;
        ctx.textBaseline = "middle";
        ctx.fillText(content, px, cursor);
        px += w;
      }
      cursor += lineHeight;
    }
    return cursor - y;
  }
  function drawTitlebar(ctx, theme, state) {
    const h = 30;
    ctx.fillStyle = theme.sidebar;
    ctx.fillRect(0, 0, 1440, h);
    ctx.strokeStyle = theme.border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, h + 0.5);
    ctx.lineTo(1440, h + 0.5);
    ctx.stroke();
    text(ctx, "\u6587\u4EF6", 60, h / 2, { color: theme.muted, font: `${TYPE.uiSmall}px ${TYPE.sans}` });
    text(ctx, "\u7F16\u8F91", 108, h / 2, { color: theme.muted, font: `${TYPE.uiSmall}px ${TYPE.sans}` });
    text(ctx, "\u89C6\u56FE", 156, h / 2, { color: theme.muted, font: `${TYPE.uiSmall}px ${TYPE.sans}` });
    text(ctx, "\u5E2E\u52A9", 204, h / 2, { color: theme.muted, font: `${TYPE.uiSmall}px ${TYPE.sans}` });
    const baseX = 1440 - 96;
    ctx.strokeStyle = theme.muted;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(baseX - 12, h / 2);
    ctx.lineTo(baseX - 4, h / 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.rect(baseX + 26, h / 2 - 4.5, 9, 9);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(baseX + 64, h / 2 - 4.5);
    ctx.lineTo(baseX + 73, h / 2 + 4.5);
    ctx.moveTo(baseX + 73, h / 2 - 4.5);
    ctx.lineTo(baseX + 64, h / 2 + 4.5);
    ctx.stroke();
  }
  function drawSidebar(ctx, theme, state) {
    const w = GEOMETRY.sidebar;
    const top = 30;
    ctx.fillStyle = theme.sidebar;
    ctx.fillRect(0, top, w, 940 - top);
    ctx.strokeStyle = theme.border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(w + 0.5, top);
    ctx.lineTo(w + 0.5, 940);
    ctx.stroke();
    text(ctx, "Pi Desktop", 16, top + 26, { font: `600 17px ${TYPE.sans}`, color: theme.text });
    icon(ctx, "chevron", 122, top + 26, 14, theme.muted);
    icon(ctx, "search", w - 26, top + 26, 16, theme.muted);
    let y = top + 62;
    for (const row of SIDEBAR_ROWS) {
      const icons = { \u65B0\u5EFA\u804A\u5929: "chat", \u5F85\u5BA1\u9605: "inbox", \u81EA\u52A8\u5316: "zap", "Skills \u4E0E\u6269\u5C55": "layers" };
      icon(ctx, icons[row.label] ?? "circle", 24, y, 16, theme.muted);
      text(ctx, row.label, 44, y, { color: theme.text, font: `${TYPE.uiWeight} 14px ${TYPE.sans}` });
      if (row.hint) text(ctx, row.hint, w - 16, y, { color: theme.tertiary, align: "right", font: `12px ${TYPE.sans}` });
      y += 32;
    }
    y += 18;
    text(ctx, "\u9879\u76EE\u804A\u5929", 16, y, { color: theme.muted, font: `${TYPE.uiSmall}px ${TYPE.sans}` });
    icon(ctx, "plus", w - 22, y, 15, theme.muted);
    y += 24;
    icon(ctx, "chevron", 22, y, 13, theme.muted);
    icon(ctx, "folder", 40, y, 15, theme.muted);
    text(ctx, CONVERSATION.project, 54, y, { color: theme.text, font: `500 13.5px ${TYPE.sans}` });
    text(ctx, "7", w - 16, y, { color: theme.tertiary, align: "right", font: `12px ${TYPE.sans}` });
    y += 26;
    const activeTitle = state.view === "home" ? "\u65B0\u4EFB\u52A1" : CONVERSATION.threadTitle;
    CONVERSATION.threads.forEach((label, index) => {
      const active = label === activeTitle;
      if (active) fillRound(ctx, 8, y - 13, w - 16, 28, GEOMETRY.radiusRow, theme.selected);
      text(ctx, label, 30, y, { color: theme.text, font: `${TYPE.uiWeight} 13.5px ${TYPE.sans}`, maxWidth: w - 60 });
      if (!active && index < 4) {
        ctx.fillStyle = theme.accent;
        ctx.beginPath();
        ctx.arc(w - 20, y, 3.2, 0, Math.PI * 2);
        ctx.fill();
      }
      y += 30;
    });
    y += 22;
    text(ctx, "\u6700\u8FD1\u4EFB\u52A1", 16, y, { color: theme.muted, font: `${TYPE.uiSmall}px ${TYPE.sans}` });
    icon(ctx, "chevron", w - 34, y, 13, theme.muted);
    y += 24;
    CONVERSATION.threads.forEach((label) => {
      const active = label === activeTitle;
      if (active) fillRound(ctx, 8, y - 13, w - 16, 28, GEOMETRY.radiusRow, theme.selected);
      text(ctx, label, 30, y, { color: theme.text, font: `${TYPE.uiWeight} 13.5px ${TYPE.sans}`, maxWidth: w - 60 });
      if (!active) {
        ctx.fillStyle = theme.accent;
        ctx.beginPath();
        ctx.arc(w - 20, y, 3.2, 0, Math.PI * 2);
        ctx.fill();
      }
      y += 30;
    });
    text(ctx, "\u03C0", 20, 908, { font: `bold 16px ${TYPE.serif}`, color: theme.text });
    text(ctx, "\u672C\u5730\u5DE5\u4F5C\u533A", 40, 908, { color: theme.text, font: `500 13.5px ${TYPE.sans}` });
    icon(ctx, "circle", w - 24, 908, 15, theme.muted);
  }
  function drawToolbar(ctx, theme, state) {
    const x0 = state.sidebarOpen ? GEOMETRY.sidebar : 0;
    const right = state.reviewOpen ? 1440 - GEOMETRY.review : 1440;
    const h = GEOMETRY.toolbar;
    ctx.fillStyle = theme.bg;
    ctx.fillRect(x0, 30, right - x0, h);
    text(ctx, CONVERSATION.project, x0 + 18, 30 + h / 2, { color: theme.tertiary, font: `${TYPE.uiSmall}px ${TYPE.sans}` });
    icon(ctx, "chevron", x0 + 74, 30 + h / 2, 13, theme.tertiary);
    text(ctx, state.view === "home" ? "\u65B0\u4EFB\u52A1" : CONVERSATION.threadTitle, x0 + 94, 30 + h / 2, {
      color: theme.text,
      font: `500 ${TYPE.uiSmall}px ${TYPE.sans}`
    });
    const pillW = 112;
    const pillX = right - 18 - pillW - 90;
    fillRound(ctx, pillX, 30 + h / 2 - 15, pillW, 30, 15, theme.surface);
    ctx.strokeStyle = theme.border;
    ctx.lineWidth = 1;
    roundRect(ctx, pillX + 0.5, 30 + h / 2 - 14.5, pillW - 1, 29, 14.5);
    ctx.stroke();
    text(ctx, "\u9879\u76EE\u52A8\u4F5C", pillX + 14, 30 + h / 2, { color: theme.text, font: `${TYPE.uiWeight} 13px ${TYPE.sans}` });
    icon(ctx, "chevron", pillX + pillW - 16, 30 + h / 2, 13, theme.muted);
    icon(ctx, "panel", right - 84, 30 + h / 2, 17, theme.muted);
    icon(ctx, "list", right - 54, 30 + h / 2, 17, theme.muted);
    icon(ctx, "dots", right - 24, 30 + h / 2, 16, theme.muted);
  }
  function drawHome(ctx, theme, state) {
    const x0 = state.sidebarOpen ? GEOMETRY.sidebar : 0;
    const right = state.reviewOpen ? 1440 - GEOMETRY.review : 1440;
    const cx = (x0 + right) / 2;
    text(ctx, "\u03C0", cx, 520, { font: `48px ${TYPE.serif}`, color: theme.tertiary, align: "center" });
    text(ctx, `\u5728 ${CONVERSATION.project} \u4E2D\u6784\u5EFA`, cx, 596, {
      font: `600 30px ${TYPE.sans}`,
      color: theme.text,
      align: "center"
    });
    text(ctx, "\u4ECE\u4E00\u4E2A\u95EE\u9898\u5F00\u59CB\uFF0C\u8BA9 Pi \u5E2E\u4F60\u628A\u60F3\u6CD5\u53D8\u6210\u4EE3\u7801\u3002", cx, 640, {
      font: `${TYPE.uiWeight} 15px ${TYPE.sans}`,
      color: theme.muted,
      align: "center"
    });
    const cw = Math.min(760, right - x0 - 80);
    const cxp = cx - cw / 2;
    const cy = 790;
    const ch = 96;
    fillRound(ctx, cxp, cy - 44, cw, 40, 12, theme.selected);
    icon(ctx, "folder", cxp + 22, cy - 24, 15, theme.muted);
    text(ctx, CONVERSATION.project, cxp + 38, cy - 24, { color: theme.text, font: `${TYPE.uiWeight} 13px ${TYPE.sans}` });
    icon(ctx, "chevron", cxp + 38 + ctx.measureText(CONVERSATION.project).width + 10, cy - 24, 12, theme.muted);
    icon(ctx, "panel", cxp + 158, cy - 24, 15, theme.muted);
    text(ctx, "\u672C\u5730", cxp + 176, cy - 24, { color: theme.text, font: `${TYPE.uiWeight} 13px ${TYPE.sans}` });
    icon(ctx, "branch", cxp + 232, cy - 24, 15, theme.muted);
    text(ctx, "\u65B0\u5EFA Worktree", cxp + 250, cy - 24, { color: theme.text, font: `${TYPE.uiWeight} 13px ${TYPE.sans}` });
    text(ctx, "\u4EFB\u52A1\u9009\u9879", cxp + cw - 62, cy - 24, { color: theme.text, font: `${TYPE.uiWeight} 13px ${TYPE.sans}` });
    icon(ctx, "chevron", cxp + cw - 22, cy - 24, 13, theme.muted);
    ctx.save();
    ctx.shadowColor = theme.shadow;
    ctx.shadowBlur = 26;
    ctx.shadowOffsetY = 4;
    fillRound(ctx, cxp, cy, cw, ch, GEOMETRY.radiusComposer, theme.surface);
    ctx.restore();
    roundRect(ctx, cxp + 0.5, cy + 0.5, cw - 1, ch - 1, GEOMETRY.radiusComposer);
    ctx.strokeStyle = theme.border;
    ctx.lineWidth = 1;
    ctx.stroke();
    const typedColor = state.typed ? theme.text : theme.tertiary;
    text(ctx, state.typed || "\u63CF\u8FF0\u4EFB\u52A1\uFF0C\u6216\u63D0\u51FA\u4E00\u4E2A\u95EE\u9898\u2026", cxp + 26, cy + 30, {
      color: typedColor,
      font: `${TYPE.uiWeight} 15px ${TYPE.sans}`
    });
    icon(ctx, "plus", cxp + 32, cy + 68, 17, theme.muted);
    icon(ctx, "shield", cxp + 62, cy + 68, 16, theme.muted);
    text(ctx, "\u8BF7\u6C42\u6279\u51C6", cxp + 78, cy + 68, { color: theme.text, font: `${TYPE.uiWeight} 13px ${TYPE.sans}` });
    icon(ctx, "chevron", cxp + 132, cy + 68, 12, theme.muted);
    text(ctx, "Local Test \u4E2D\u7B49", cxp + cw - 96, cy + 68, { color: theme.text, font: `${TYPE.uiWeight} 13px ${TYPE.sans}` });
    icon(ctx, "chevron", cxp + cw - 60, cy + 68, 12, theme.muted);
    ctx.fillStyle = state.typed ? theme.bubble : theme.selected;
    ctx.beginPath();
    ctx.arc(cxp + cw - 28, cy + 68, 16, 0, Math.PI * 2);
    ctx.fill();
    icon(ctx, "send", cxp + cw - 28, cy + 68, 17, state.typed ? theme.bubbleText : theme.muted);
  }
  function drawUserBubble(ctx, theme, value, x0, right, y) {
    const maxW = Math.min(620, right - x0 - 120);
    ctx.font = `${TYPE.uiWeight} 15px ${TYPE.sans}`;
    const w = Math.min(maxW, ctx.measureText(value).width + 44);
    const x = right - 60 - w;
    fillRound(ctx, x, y, w, 46, 23, theme.bubble);
    text(ctx, value, x + 22, y + 23, { color: theme.bubbleText, font: `${TYPE.uiWeight} 15px ${TYPE.sans}` });
    return y + 46;
  }
  function drawToolCard(ctx, theme, tool, x, y, width, open) {
    const collapsedH = 38;
    const expandedH = collapsedH + 96 * open;
    fillRound(ctx, x, y, width, collapsedH + (expandedH - collapsedH), 10, theme.surface);
    roundRect(ctx, x + 0.5, y + 0.5, width - 1, collapsedH + (expandedH - collapsedH) - 1, 10);
    ctx.strokeStyle = theme.border;
    ctx.lineWidth = 1;
    ctx.stroke();
    text(ctx, tool.name, x + 16, y + collapsedH / 2, { font: `${TYPE.uiWeight} 13px ${TYPE.mono}`, color: theme.text });
    text(ctx, open > 0.5 ? "\u5DF2\u5B8C\u6210" : "1 \u6B21\u8BFB\u53D6", x + width - 62, y + collapsedH / 2, {
      color: theme.muted,
      font: `${TYPE.uiSmall}px ${TYPE.sans}`
    });
    icon(ctx, "chevron", x + width - 20, y + collapsedH / 2, 13, theme.muted);
    if (open > 0.01) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y + collapsedH, width, expandedH - collapsedH);
      ctx.clip();
      ctx.globalAlpha = Math.min(1, open);
      fillRound(ctx, x + 10, y + collapsedH + 2, width - 20, 82, 8, theme.codeBg);
      text(ctx, `> ${tool.args}`, x + 22, y + collapsedH + 22, { font: `12.5px ${TYPE.mono}`, color: theme.muted });
      text(ctx, tool.output, x + 22, y + collapsedH + 48, { font: `12.5px ${TYPE.mono}`, color: theme.text });
      ctx.restore();
    }
    return collapsedH + (expandedH - collapsedH);
  }
  function transcriptBlocks(x0, right, contentW, state) {
    const blocks = [];
    blocks.push({
      height: 80,
      draw(ctx, theme, y) {
        drawUserBubble(ctx, theme, CONVERSATION.userTurns[0], x0, right, y);
      }
    });
    if (state.revealUser > 0.15) {
      blocks.push({
        height: state.thinkingShown ? 118 : 92,
        draw(ctx, theme, y) {
          text(ctx, "\u5904\u7406\u8FC7\u7A0B", x0 + 60, y, { color: theme.muted, font: `${TYPE.uiSmall}px ${TYPE.sans}` });
          icon(ctx, "chevron", x0 + 122, y, 13, theme.muted);
          text(ctx, "\u601D\u8003\u8FC7\u7A0B", x0 + 70, y + 30, { color: theme.text, font: `500 ${TYPE.uiSmall}px ${TYPE.sans}` });
          if (state.thinkingShown) {
            text(ctx, CONVERSATION.thinking, x0 + 70, y + 54, {
              color: theme.muted,
              font: `${TYPE.uiWeight} ${TYPE.uiSmall}px ${TYPE.sans}`
            });
          }
        }
      });
    }
    if (state.revealUser > 0.22) {
      blocks.push({
        height: 38 + 96 * state.toolOpen + 24,
        draw(ctx, theme, y) {
          drawToolCard(ctx, theme, CONVERSATION.tools[0], x0 + 60, y, contentW, state.toolOpen);
        }
      });
    }
    if (state.revealUser > 0.35) {
      blocks.push({
        height: 42,
        draw(ctx, theme, y) {
          text(ctx, CONVERSATION.assistantTurns[0], x0 + 60, y, {
            color: theme.text,
            font: `${TYPE.uiWeight} 15px ${TYPE.sans}`
          });
        }
      });
    }
    if (state.revealUser > 0.5) {
      blocks.push({
        height: 72,
        draw(ctx, theme, y) {
          const nw = 470;
          fillRound(ctx, x0 + 60, y, nw, 46, 12, theme.surface);
          roundRect(ctx, x0 + 60.5, y + 0.5, nw - 1, 45, 12);
          ctx.strokeStyle = theme.border;
          ctx.stroke();
          icon(ctx, "circle", x0 + 88, y + 23, 16, theme.muted);
          text(ctx, CONVERSATION.notice, x0 + 108, y + 23, {
            color: theme.muted,
            font: `${TYPE.uiWeight} 13.5px ${TYPE.sans}`
          });
        }
      });
    }
    if (state.revealUser > 0.62) {
      blocks.push({
        height: 82,
        draw(ctx, theme, y) {
          drawUserBubble(ctx, theme, CONVERSATION.userTurns[1], x0, right, y);
        }
      });
    }
    if (state.revealUser > 0.78) {
      blocks.push({
        height: 36,
        draw(ctx, theme, y) {
          text(ctx, "\u5904\u7406\u8FC7\u7A0B 1 \u4E2A\u64CD\u4F5C", x0 + 60, y, { color: theme.muted, font: `${TYPE.uiSmall}px ${TYPE.sans}` });
          icon(ctx, "chevron", x0 + 172, y, 13, theme.muted);
        }
      });
    }
    if (state.revealUser > 0.85 && (state.streamText || state.revealUser > 0.9)) {
      const body = state.streamText || CONVERSATION.assistantTurns[1];
      blocks.push({
        height: 150,
        draw(ctx, theme, y) {
          markdown(ctx, body, x0 + 60, y + 6, contentW, theme, 27, 15);
        }
      });
    }
    return blocks;
  }
  function drawWorkbench(ctx, theme, state) {
    const x0 = state.sidebarOpen ? GEOMETRY.sidebar : 0;
    const right = state.reviewOpen ? 1440 - GEOMETRY.review : 1440;
    const top = 72;
    const bottom = 782;
    const blocks = transcriptBlocks(x0, right, Math.min(700, right - x0 - 120), state);
    const gap = 26;
    let cursor = 0;
    const placed = blocks.map((block) => {
      const item = { block, y: cursor };
      cursor += block.height + gap;
      return item;
    });
    const total = Math.max(0, cursor - gap);
    const available = bottom - top;
    const scroll = Math.max(0, total - available);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, 30, right - x0, 940 - 30);
    ctx.clip();
    for (const item of placed) {
      const y = top + item.y - scroll;
      if (y + item.block.height < top - 4 || y > bottom + 4) continue;
      item.block.draw(ctx, theme, y);
    }
    ctx.restore();
    if (state.revealUser > 0.95) {
      const contentW = Math.min(700, right - x0 - 120);
      const pw = contentW;
      const py = 794;
      fillRound(ctx, x0 + 60, py, pw, 40, 10, theme.surface);
      roundRect(ctx, x0 + 60.5, py + 0.5, pw - 1, 39, 10);
      ctx.strokeStyle = theme.border;
      ctx.stroke();
      icon(ctx, "list", x0 + 84, py + 20, 15, theme.muted);
      text(ctx, "\u8BA1\u5212 \xB7 1/2 \xB7 \u8865\u5145\u5B89\u88C5\u6B65\u9AA4", x0 + 104, py + 20, {
        color: theme.muted,
        font: `${TYPE.uiWeight} 13px ${TYPE.sans}`
      });
    }
    drawComposer(ctx, theme, state, x0, right);
  }
  function drawComposer(ctx, theme, state, x0, right) {
    const cw = Math.min(760, right - x0 - 80);
    const cxp = (x0 + right) / 2 - cw / 2;
    const cy = 812;
    const ch = 88;
    ctx.save();
    ctx.shadowColor = theme.shadow;
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 3;
    fillRound(ctx, cxp, cy, cw, ch, GEOMETRY.radiusComposer, theme.surface);
    ctx.restore();
    roundRect(ctx, cxp + 0.5, cy + 0.5, cw - 1, ch - 1, GEOMETRY.radiusComposer);
    ctx.strokeStyle = theme.border;
    ctx.lineWidth = 1;
    ctx.stroke();
    const placeholder = state.typed ? "" : "\u63CF\u8FF0\u4EFB\u52A1\uFF0C\u6216\u63D0\u51FA\u4E00\u4E2A\u95EE\u9898\u2026";
    text(ctx, placeholder, cxp + 26, cy + 30, { color: theme.tertiary, font: `${TYPE.uiWeight} 15px ${TYPE.sans}` });
    if (state.typed) {
      text(ctx, state.typed, cxp + 26, cy + 30, { color: theme.text, font: `${TYPE.uiWeight} 15px ${TYPE.sans}` });
      const caretX = cxp + 26 + ctx.measureText(state.typed).width + 2;
      if (state.caretOn !== false) {
        ctx.fillStyle = theme.text;
        ctx.fillRect(caretX, cy + 20, 1.6, 20);
      }
    }
    icon(ctx, "plus", cxp + 32, cy + 64, 17, theme.muted);
    icon(ctx, "shield", cxp + 62, cy + 64, 16, theme.muted);
    text(ctx, "\u8BF7\u6C42\u6279\u51C6", cxp + 78, cy + 64, { color: theme.text, font: `${TYPE.uiWeight} 13px ${TYPE.sans}` });
    icon(ctx, "chevron", cxp + 132, cy + 64, 12, theme.muted);
    text(ctx, "Local Test \u4E2D\u7B49", cxp + cw - 96, cy + 64, { color: theme.text, font: `${TYPE.uiWeight} 13px ${TYPE.sans}` });
    icon(ctx, "chevron", cxp + cw - 60, cy + 64, 12, theme.muted);
    ctx.fillStyle = state.typed ? theme.bubble : theme.selected;
    ctx.beginPath();
    ctx.arc(cxp + cw - 28, cy + 64, 16, 0, Math.PI * 2);
    ctx.fill();
    icon(ctx, "send", cxp + cw - 28, cy + 64, 17, state.typed ? theme.bubbleText : theme.muted);
  }
  function drawReviewPane(ctx, theme, state) {
    const x0 = 1440 - GEOMETRY.review;
    ctx.fillStyle = theme.bg;
    ctx.fillRect(x0, 30, GEOMETRY.review, 940 - 30);
    ctx.strokeStyle = theme.border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x0 + 0.5, 30);
    ctx.lineTo(x0 + 0.5, 940);
    ctx.stroke();
    const pad2 = 18;
    const cxp = x0 + pad2;
    const cw = GEOMETRY.review - pad2 * 2;
    const cardH = 150;
    fillRound(ctx, cxp, 54, cw, cardH, 14, theme.surface);
    roundRect(ctx, cxp + 0.5, 54.5, cw - 1, cardH - 1, 14);
    ctx.strokeStyle = theme.border;
    ctx.stroke();
    text(ctx, CONVERSATION.project, cxp + 18, 78, { color: theme.text, font: `500 14px ${TYPE.sans}` });
    icon(ctx, "dots", cxp + cw - 22, 78, 15, theme.muted);
    icon(ctx, "branch", cxp + 26, 106, 15, theme.muted);
    text(ctx, "main", cxp + 42, 106, { color: theme.text, font: `600 14px ${TYPE.sans}` });
    text(ctx, "+7", cxp + cw - 62, 106, { color: theme.success, font: `600 13.5px ${TYPE.sans}`, align: "right" });
    text(ctx, "-0", cxp + cw - 20, 106, { color: theme.danger, font: `600 13.5px ${TYPE.sans}`, align: "right" });
    text(ctx, "\u6765\u6E90", cxp + 18, 138, { color: theme.muted, font: `${TYPE.uiSmall}px ${TYPE.sans}` });
    text(ctx, "\u6682\u65E0\u5916\u90E8\u6765\u6E90", cxp + 18, 162, { color: theme.tertiary, font: `${TYPE.uiWeight} ${TYPE.uiSmall}px ${TYPE.sans}` });
    icon(ctx, "chevron", cxp + cw - 22, 162, 13, theme.muted);
    fillRound(ctx, cxp + 18, 184, 108, 28, 14, theme.selected);
    text(ctx, "\u5EFA\u8BAE\u5BA1\u67E5\u6539\u52A8", cxp + 72, 198, { color: theme.text, font: `${TYPE.uiWeight} 12.5px ${TYPE.sans}`, align: "center" });
    let ty = 250;
    const tabs = [
      { id: "changes", label: "\u53D8\u66F4" },
      { id: "files", label: "\u6587\u4EF6" },
      { id: "plan", label: "\u8BA1\u5212" }
    ];
    let tx = cxp;
    for (const tab of tabs) {
      const active = state.reviewTab === tab.id;
      ctx.font = `${TYPE.uiWeight} 13.5px ${TYPE.sans}`;
      const tw = ctx.measureText(tab.label).width + 20;
      if (active) fillRound(ctx, tx, ty - 14, tw, 28, 8, theme.selected);
      text(ctx, tab.label, tx + tw / 2, ty, {
        color: active ? theme.text : theme.muted,
        font: `${TYPE.uiWeight} 13.5px ${TYPE.sans}`,
        align: "center"
      });
      tx += tw + 6;
    }
    ty += 32;
    if (state.reviewTab === "plan") {
      CONVERSATION.plan.forEach((step, index) => {
        const done = step.status === "completed" || index === 1 && state.planProgress > 0.5;
        icon(ctx, done ? "check" : "dot", cxp + 12, ty, 15, done ? theme.accent : theme.muted);
        text(ctx, step.text, cxp + 32, ty, { color: theme.text, font: `${TYPE.uiWeight} 13.5px ${TYPE.sans}` });
        ty += 30;
      });
    } else {
      const files = [
        { name: "README.md", adds: 7, dels: 0, selected: state.diffOpen > 0.2 },
        { name: "hello.txt", adds: 1, dels: 0, selected: !state.diffOpen }
      ];
      for (const file of files) {
        if (file.selected) fillRound(ctx, cxp - 6, ty - 15, cw + 12, 34, 8, theme.selected);
        text(ctx, file.name, cxp + 6, ty, { color: theme.text, font: `${TYPE.uiWeight} 13.5px ${TYPE.sans}` });
        text(ctx, `+${file.adds}`, cxp + cw - 48, ty, { color: theme.success, font: `600 12.5px ${TYPE.sans}`, align: "right" });
        text(ctx, `-${file.dels}`, cxp + cw - 8, ty, { color: theme.danger, font: `600 12.5px ${TYPE.sans}`, align: "right" });
        ty += 38;
      }
      if (state.diffOpen > 0.01) {
        const dh = 300 * state.diffOpen;
        ctx.save();
        ctx.beginPath();
        ctx.rect(cxp, ty, cw, dh);
        ctx.clip();
        ctx.globalAlpha = Math.min(1, state.diffOpen);
        fillRound(ctx, cxp, ty, cw, dh, 10, theme.surface);
        roundRect(ctx, cxp + 0.5, ty + 0.5, cw - 1, dh - 1, 10);
        ctx.strokeStyle = theme.border;
        ctx.stroke();
        let dy = ty + 26;
        const rows = [
          { n: 1, t: " # \u793A\u4F8B\u9879\u76EE", kind: "ctx" },
          { n: 2, t: "", kind: "ctx" },
          { n: 3, t: " \u4E00\u4E2A\u7528\u4E8E\u6F14\u793A\u7684\u672C\u5730\u9879\u76EE\u3002", kind: "ctx" },
          { n: 4, t: "", kind: "ctx" },
          { n: 5, t: "+", kind: "add", t2: "## \u5B89\u88C5" },
          { n: 6, t: "+", kind: "add", t2: "" },
          { n: 7, t: "+", kind: "add", t2: "```bash" },
          { n: 8, t: "+", kind: "add", t2: "npm install" },
          { n: 9, t: "+", kind: "add", t2: "npm run dev" },
          { n: 10, t: "+", kind: "add", t2: "```" }
        ];
        for (const row of rows) {
          const isAdd = row.kind === "add";
          if (isAdd) {
            ctx.fillStyle = theme.diffAdded;
            ctx.fillRect(cxp + 1, dy - 9, cw - 2, 20);
          }
          text(ctx, String(row.n), cxp + 12, dy, { color: theme.tertiary, font: `11.5px ${TYPE.mono}` });
          if (isAdd) {
            text(ctx, "+", cxp + 34, dy, { color: theme.success, font: `11.5px ${TYPE.mono}` });
            text(ctx, row.t2, cxp + 48, dy, { color: theme.text, font: `11.5px ${TYPE.mono}` });
          } else {
            text(ctx, row.t, cxp + 48, dy, { color: theme.muted, font: `11.5px ${TYPE.mono}` });
          }
          dy += 24;
        }
        ctx.restore();
      }
    }
  }
  function drawSettings(ctx, theme, state) {
    const top = 30;
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, top, 1440, 940 - top);
    ctx.fillStyle = theme.sidebar;
    ctx.fillRect(0, top, 380, 940 - top);
    text(ctx, "\u2190 \u8FD4\u56DE\u5DE5\u4F5C\u53F0", 28, top + 34, { color: theme.text, font: `${TYPE.uiWeight} 13.5px ${TYPE.sans}` });
    fillRound(ctx, 20, top + 60, 340, 34, 10, theme.surface);
    icon(ctx, "search", 42, top + 77, 15, theme.muted);
    text(ctx, "\u641C\u7D22\u8BBE\u7F6E", 62, top + 77, { color: theme.tertiary, font: `${TYPE.uiWeight} 13.5px ${TYPE.sans}` });
    const groups = [
      { title: "\u4E2A\u4EBA", items: ["\u901A\u7528", "\u5916\u89C2", "\u952E\u76D8\u5FEB\u6377\u952E", "\u8DE8\u4F1A\u8BDD\u8BB0\u5FC6", "\u79BB\u7EBF\u8BED\u97F3"], icons: ["settings", "circle", "list", "circle", "circle"] },
      { title: "\u96C6\u6210", items: ["MCP", "\u6D4F\u89C8\u5668\u8FDE\u63A5"], icons: ["circle", "circle"] },
      { title: "\u7F16\u7801", items: ["\u6A21\u578B", "\u5BA1\u6279\u4E0E\u4FE1\u4EFB"], icons: ["layers", "shield"] }
    ];
    let sy = top + 124;
    for (const group of groups) {
      text(ctx, group.title, 28, sy, { color: theme.muted, font: `${TYPE.uiSmall}px ${TYPE.sans}` });
      sy += 26;
      group.items.forEach((item, index) => {
        const active = item === "\u6A21\u578B";
        if (active) fillRound(ctx, 14, sy - 15, 352, 30, 8, theme.selected);
        icon(ctx, group.icons[index], 34, sy, 15, theme.muted);
        text(ctx, item, 56, sy, { color: theme.text, font: `${TYPE.uiWeight} 13.5px ${TYPE.sans}` });
        sy += 32;
      });
      sy += 14;
    }
    const mx = 460;
    text(ctx, "\u6A21\u578B", mx, 106, { font: `600 22px ${TYPE.sans}`, color: theme.text });
    text(ctx, "\u7BA1\u7406\u6A21\u578B\u8FDE\u63A5\u3001\u51ED\u636E\u548C\u80FD\u529B\uFF0C\u4F9B\u4EFB\u52A1\u9009\u62E9\u3002", mx, 140, { color: theme.muted, font: `${TYPE.uiWeight} 13.5px ${TYPE.sans}` });
    text(ctx, "\u63D0\u4F9B\u5546", mx, 182, { font: `500 14px ${TYPE.sans}`, color: theme.text });
    text(ctx, "1 \u4E2A\u8FDE\u63A5", mx, 208, { color: theme.muted, font: `${TYPE.uiSmall}px ${TYPE.sans}` });
    text(ctx, "1", 862, 182, { color: theme.muted, align: "right", font: `${TYPE.uiSmall}px ${TYPE.sans}` });
    fillRound(ctx, mx, 232, 300, 68, 12, theme.surface);
    roundRect(ctx, mx + 0.5, 232.5, 299, 67, 12);
    ctx.strokeStyle = theme.borderStrong;
    ctx.stroke();
    text(ctx, "Local Test", mx + 16, 256, { color: theme.text, font: `500 14px ${TYPE.sans}` });
    text(ctx, "\u81EA\u5B9A\u4E49\u63A5\u53E3 \xB7 1 \u4E2A\u6A21\u578B", mx + 16, 278, { color: theme.muted, font: `${TYPE.uiSmall}px ${TYPE.sans}` });
    text(ctx, "\u5F53\u524D\u9ED8\u8BA4", mx + 284, 256, { color: theme.muted, align: "right", font: `12px ${TYPE.sans}` });
    fillRound(ctx, mx, 316, 300, 32, 10, theme.surface);
    roundRect(ctx, mx + 0.5, 316.5, 299, 31, 10);
    ctx.strokeStyle = theme.border;
    ctx.stroke();
    text(ctx, "+ \u6DFB\u52A0\u63D0\u4F9B\u5546", mx + 150, 332, { color: theme.text, align: "center", font: `${TYPE.uiWeight} 13.5px ${TYPE.sans}` });
    const dx = 900;
    text(ctx, "\u81EA\u5B9A\u4E49\u63A5\u53E3", dx, 208, { color: theme.muted, font: `${TYPE.uiSmall}px ${TYPE.sans}` });
    text(ctx, "Local Test", dx, 234, { font: `600 20px ${TYPE.sans}`, color: theme.text });
    text(ctx, "http://127.0.0.1:9/v1 \xB7 1 \u4E2A\u6A21\u578B", dx, 260, { color: theme.muted, font: `${TYPE.uiSmall}px ${TYPE.sans}` });
    text(ctx, "\u8FDE\u63A5\u4E0E\u51ED\u636E", dx, 300, { font: `500 14px ${TYPE.sans}`, color: theme.text });
    const fields = [
      ["\u663E\u793A\u540D\u79F0", "Local Test"],
      ["API \u534F\u8BAE", "OpenAI \u517C\u5BB9\uFF08Chat Completion\uFF09"],
      ["Base URL", "http://127.0.0.1:9/v1"],
      ["API Key", "\u8F93\u5165 API Key"]
    ];
    let fy = 330;
    for (const [label, value] of fields) {
      text(ctx, label, dx, fy + 16, { color: theme.text, font: `500 13.5px ${TYPE.sans}` });
      fillRound(ctx, dx + 180, fy, 340, 34, 10, theme.surface);
      roundRect(ctx, dx + 180.5, fy + 0.5, 339, 33, 10);
      ctx.strokeStyle = theme.border;
      ctx.stroke();
      text(ctx, value, dx + 194, fy + 17, { color: theme.text, font: `${TYPE.uiWeight} 13px ${TYPE.sans}` });
      fy += 56;
    }
  }
  function drawTerminal(ctx, theme, state) {
    const x0 = 1440 - GEOMETRY.review;
    ctx.fillStyle = "rgb(24,24,24)";
    ctx.fillRect(x0, 30, GEOMETRY.review, 940 - 30);
    ctx.strokeStyle = theme.border;
    ctx.beginPath();
    ctx.moveTo(x0 + 0.5, 30);
    ctx.lineTo(x0 + 0.5, 940);
    ctx.stroke();
    const lines = [
      { t: "PS E:\\\u793A\u4F8B\u9879\u76EE> git status", c: "rgb(223,223,223)" },
      { t: "On branch main", c: "rgb(223,223,223)" },
      { t: "Changes not staged for commit:", c: "rgb(223,223,223)" },
      { t: "        modified:   README.md", c: "rgb(250,66,62)" },
      { t: "Untracked files:", c: "rgb(223,223,223)" },
      { t: "        hello.txt", c: "rgb(64,201,119)" },
      { t: "PS E:\\\u793A\u4F8B\u9879\u76EE> _", c: "rgb(223,223,223)" }
    ];
    let ty = 66;
    lines.slice(0, state.terminalLines).forEach((line) => {
      text(ctx, line.t, x0 + 18, ty, { font: `12.5px ${TYPE.mono}`, color: line.c });
      ty += 22;
    });
  }
  function drawPalette(ctx, theme, state) {
    ctx.fillStyle = theme.isDark ? "rgba(0,0,0,.5)" : "rgba(26,28,31,.18)";
    ctx.fillRect(0, 30, 1440, 940 - 30);
    const w = 620;
    const x = (1440 - w) / 2;
    const y = 140;
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,.32)";
    ctx.shadowBlur = 48;
    ctx.shadowOffsetY = 16;
    fillRound(ctx, x, y, w, 60, 16, theme.surface);
    ctx.restore();
    roundRect(ctx, x + 0.5, y + 0.5, w - 1, 59, 16);
    ctx.strokeStyle = theme.borderStrong;
    ctx.stroke();
    icon(ctx, "search", x + 30, y + 30, 17, theme.muted);
    text(ctx, state.paletteQuery || "\u641C\u7D22\u547D\u4EE4\u6216\u6700\u8FD1\u4EFB\u52A1", x + 52, y + 30, {
      color: state.paletteQuery ? theme.text : theme.tertiary,
      font: `${TYPE.uiWeight} 15px ${TYPE.sans}`
    });
    const results = [
      { label: "\u65B0\u5EFA\u4EFB\u52A1", keys: "Ctrl N", icon: "chat" },
      { label: "\u641C\u7D22\u4EFB\u52A1", keys: "Ctrl K", icon: "search" },
      { label: "\u6253\u5F00\u8BBE\u7F6E", keys: "Ctrl ,", icon: "settings" },
      { label: "\u5207\u6362\u96C6\u6210\u7EC8\u7AEF", keys: "Ctrl J", icon: "list" },
      { label: "\u547D\u4EE4\u9762\u677F", keys: "Ctrl Shift P", icon: "layers" }
    ];
    const lh = 46;
    const listH = results.length * lh + 16;
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,.28)";
    ctx.shadowBlur = 40;
    ctx.shadowOffsetY = 14;
    fillRound(ctx, x, y + 68, w, listH, 16, theme.surface);
    ctx.restore();
    roundRect(ctx, x + 0.5, y + 68.5, w - 1, listH - 1, 16);
    ctx.strokeStyle = theme.border;
    ctx.stroke();
    results.forEach((result, index) => {
      const ry = y + 84 + index * lh;
      if (index === 0) fillRound(ctx, x + 8, ry, w - 16, 40, 10, theme.hover);
      icon(ctx, result.icon, x + 30, ry + 20, 16, theme.muted);
      text(ctx, result.label, x + 52, ry + 20, { color: theme.text, font: `${TYPE.uiWeight} 14px ${TYPE.sans}` });
      text(ctx, result.keys, x + w - 24, ry + 20, { color: theme.tertiary, align: "right", font: `12px ${TYPE.sans}` });
    });
  }
  function drawApp(ctx, theme, state) {
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, 1440, 940);
    if (state.view === "settings") {
      drawTitlebar(ctx, theme, state);
      drawSettings(ctx, theme, state);
      return;
    }
    if (state.sidebarOpen) drawSidebar(ctx, theme, state);
    drawToolbar(ctx, theme, state);
    if (state.view === "home") drawHome(ctx, theme, state);
    else drawWorkbench(ctx, theme, state);
    if (state.view === "terminal") drawTerminal(ctx, theme, state);
    else if (state.reviewOpen) drawReviewPane(ctx, theme, state);
    if (state.view === "palette") drawPalette(ctx, theme, state);
    drawTitlebar(ctx, theme, state);
  }

  // tools/promo/scene/copy.js
  var COPY = {
    product: "Pi Desktop",
    tagline: "\u628A\u60F3\u6CD5\u53D8\u6210\u4EE3\u7801",
    subtitle: "\u9762\u5411 Windows \u7684\u672C\u5730\u7F16\u7801\u5DE5\u4F5C\u53F0",
    endCard: "pi.dev",
    // Lower-third captions, each starting just after its scene cuts in (timeline.js).
    captions: [
      { time: 28.5, text: "\u771F\u5B9E\u6539\u52A8\uFF0C\u9010\u884C\u53EF\u67E5" },
      { time: 31.7, text: "\u8BA1\u5212\u4E0E\u4EA7\u7269\uFF0C\u5168\u7A0B\u53EF\u89C1" },
      { time: 34.6, text: "\u5185\u7F6E\u7EC8\u7AEF" },
      { time: 38, text: "\u547D\u4EE4\u9762\u677F" },
      { time: 42.9, text: "\u6A21\u578B\u4E0E\u51ED\u636E\uFF0C\u968F\u4F60\u914D\u7F6E" },
      { time: 47.7, text: "\u6D45\u8272\u4E0E\u6DF1\u8272" }
    ]
  };

  // tools/promo/scene/atmosphere.js
  function drawStage(ctx, time) {
    const gradient = ctx.createRadialGradient(FRAME.width * 0.5, FRAME.height * 0.42, 80, FRAME.width * 0.5, FRAME.height * 0.5, FRAME.width * 0.78);
    gradient.addColorStop(0, "#14161a");
    gradient.addColorStop(1, "#0a0b0d");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, FRAME.width, FRAME.height);
    ctx.strokeStyle = "rgba(255,255,255,.028)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x < FRAME.width; x += 64) {
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, FRAME.height);
    }
    for (let y = 0; y < FRAME.height; y += 64) {
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(FRAME.width, y + 0.5);
    }
    ctx.stroke();
    for (let i = 0; i < 46; i += 1) {
      const seed = i * 127.1;
      const speed = 8 + i % 7 * 3;
      const x = (seed * 7.3 % FRAME.width + Math.sin(time * 0.12 + i) * 40 + FRAME.width) % FRAME.width;
      const y = FRAME.height - ((time * speed + seed * 3.7) % (FRAME.height + 120) - 60);
      const r = 0.7 + i % 5 * 0.42;
      const alpha = 0.05 + 0.07 * (0.5 + 0.5 * Math.sin(time * 0.7 + i * 1.7));
      ctx.fillStyle = `rgba(200,215,235,${alpha.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  function drawWindowGlow(ctx, rect, amount) {
    if (amount <= 0.01) return;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const g = ctx.createRadialGradient(cx, cy, rect.width * 0.1, cx, cy, rect.width * 0.75);
    g.addColorStop(0, `rgba(44,103,197,${(0.16 * amount).toFixed(3)})`);
    g.addColorStop(0.55, `rgba(44,103,197,${(0.05 * amount).toFixed(3)})`);
    g.addColorStop(1, "rgba(44,103,197,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, FRAME.width, FRAME.height);
  }
  function drawVignette(ctx, strength = 1) {
    const g = ctx.createRadialGradient(FRAME.width / 2, FRAME.height / 2, FRAME.height * 0.32, FRAME.width / 2, FRAME.height / 2, FRAME.width * 0.72);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, `rgba(0,0,0,${0.55 * strength})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, FRAME.width, FRAME.height);
  }
  var SWEEP_BAND = 0.42;
  var SWEEP_SLANT = 0.35;
  function sweepCenter(left, width, progress) {
    const bandWidth = width * SWEEP_BAND;
    return left - bandWidth / 2 + (width + bandWidth * 2) * progress;
  }
  function drawLightSweep(ctx, rect, progress, intensity = 1) {
    if (progress <= 0 || progress >= 1 || intensity <= 0) return;
    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.left, rect.top, rect.width, rect.height);
    ctx.clip();
    const bandWidth = rect.width * SWEEP_BAND;
    const x = sweepCenter(rect.left, rect.width, progress) - bandWidth / 2;
    const g = ctx.createLinearGradient(x, rect.top, x + bandWidth, rect.top + rect.height * 0.3);
    const peak = 0.2 * intensity;
    g.addColorStop(0, "rgba(255,255,255,0)");
    g.addColorStop(0.42, `rgba(255,255,255,${(peak * 0.45).toFixed(3)})`);
    g.addColorStop(0.5, `rgba(255,255,255,${peak.toFixed(3)})`);
    g.addColorStop(0.58, `rgba(255,255,255,${(peak * 0.45).toFixed(3)})`);
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x, rect.top - 20);
    ctx.lineTo(x + bandWidth, rect.top - 20);
    ctx.lineTo(x + bandWidth - rect.height * SWEEP_SLANT, rect.top + rect.height + 20);
    ctx.lineTo(x - rect.height * SWEEP_SLANT, rect.top + rect.height + 20);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  function drawLogo(ctx, cx, cy, size, progress, color = "#EFEFE7", bg = "#262827", opacity = 1) {
    const scale = size / 256;
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);
    ctx.translate(-128, -128);
    if (bg) {
      const r = 56;
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.moveTo(r, 0);
      ctx.arcTo(256, 0, 256, 256, r);
      ctx.arcTo(256, 256, 0, 256, r);
      ctx.arcTo(0, 256, 0, 0, r);
      ctx.arcTo(0, 0, 256, 0, r);
      ctx.closePath();
      ctx.fill();
    }
    const strokes = [
      [53, 87, 85, 69, 156, 87, 199, 78],
      [94, 83, 94, 123, 93, 160, 73, 183],
      [158, 85, 153, 132, 147, 195, 184, 180]
    ];
    ctx.strokeStyle = color;
    ctx.lineWidth = 18;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    strokes.forEach((s, index) => {
      const from = index / strokes.length;
      const to = (index + 1) / strokes.length;
      const local = Math.max(0, Math.min(1, (progress - from) / (to - from)));
      if (local <= 0) return;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(s[0], s[1]);
      ctx.bezierCurveTo(s[2], s[3], s[4], s[5], s[6], s[7]);
      const length = approximateLength(s);
      ctx.setLineDash([length, length]);
      ctx.lineDashOffset = length * (1 - local);
      ctx.stroke();
      ctx.restore();
    });
    ctx.restore();
  }
  function approximateLength(s) {
    const [x0, y0, c1x, c1y, c2x, c2y, x1, y1] = s;
    let length = 0;
    let px = x0;
    let py = y0;
    for (let i = 1; i <= 24; i += 1) {
      const t = i / 24;
      const mt = 1 - t;
      const x = mt ** 3 * x0 + 3 * mt ** 2 * t * c1x + 3 * mt * t ** 2 * c2x + t ** 3 * x1;
      const y = mt ** 3 * y0 + 3 * mt ** 2 * t * c1y + 3 * mt * t ** 2 * c2y + t ** 3 * y1;
      length += Math.hypot(x - px, y - py);
      px = x;
      py = y;
    }
    return length;
  }
  function drawEndCard(ctx, time, opts) {
    const { logoProgress, logoAlpha, textAlpha, glow } = opts;
    const cx = FRAME.width / 2;
    const cy = FRAME.height / 2 - 40;
    if (glow > 0) {
      const g = ctx.createRadialGradient(cx, cy, 20, cx, cy, 460);
      g.addColorStop(0, `rgba(44,103,197,${(0.22 * glow).toFixed(3)})`);
      g.addColorStop(1, "rgba(44,103,197,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, FRAME.width, FRAME.height);
    }
    drawLogo(ctx, cx, cy, 132, logoProgress, "#EFEFE7", "#262827", logoAlpha);
    if (textAlpha > 0.01) {
      ctx.save();
      ctx.globalAlpha = textAlpha;
      const rise = (1 - textAlpha) * 16;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#EFEFE7";
      ctx.font = `600 62px ${TYPE.sans}`;
      ctx.fillText(COPY.product, cx, cy + 150 + rise);
      ctx.fillStyle = "rgba(239,239,231,.62)";
      ctx.font = `${TYPE.uiWeight} 22px ${TYPE.sans}`;
      ctx.fillText(COPY.subtitle, cx, cy + 208 + rise);
      ctx.fillStyle = "rgba(239,239,231,.4)";
      ctx.font = `${TYPE.uiWeight} 18px ${TYPE.sans}`;
      ctx.fillText(COPY.endCard, cx, cy + 252 + rise);
      ctx.restore();
    }
  }
  function drawCaption(ctx, text2, alpha, y = 980) {
    if (alpha <= 0.01) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = `500 30px ${TYPE.sans}`;
    const w = ctx.measureText(text2).width;
    const padX = 34;
    const boxW = w + padX * 2;
    const x = FRAME.width / 2 - boxW / 2;
    ctx.fillStyle = "rgba(16,18,22,.72)";
    const r = 28;
    ctx.beginPath();
    ctx.moveTo(x + r, y - 26);
    ctx.arcTo(x + boxW, y - 26, x + boxW, y + 26, r);
    ctx.arcTo(x + boxW, y + 26, x, y + 26, r);
    ctx.arcTo(x, y + 26, x, y - 26, r);
    ctx.arcTo(x, y - 26, x + boxW, y - 26, r);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,.09)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = "#EFEFE7";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text2, FRAME.width / 2, y + 1);
    ctx.restore();
  }
  function drawFrame(ctx) {
    ctx.strokeStyle = "rgba(255,255,255,.05)";
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, FRAME.width - 2, FRAME.height - 2);
  }

  // tools/promo/scene/timeline.js
  var DURATION = 60;
  var PARK_Z = 1440;
  var SHOTS = [
    // 0-3.8s: the logo draws itself over an empty stage. Two identical poses hold
    // the window invisible; without the second, opacity would ramp from 0s.
    { start: 0, end: 3.8, x: 0, y: 30, z: 3400, rotX: 0, rotY: 0, rotZ: 0, opacity: 0, glow: 0, ease: "smooth" },
    { start: 3.8, end: 4.6, x: 0, y: 30, z: 3400, rotX: 0, rotY: 0, rotZ: 0, opacity: 0, glow: 0, ease: "smooth" },
    // 4.6-9.8s: the window, already faded up in the distance, flies in to park.
    { start: 4.6, end: 9.8, x: 0, y: 30, z: 3400, rotX: 0, rotY: 0, rotZ: 0, opacity: 0.85, glow: 0.25, ease: "smooth" },
    // 9.8-15s: the fly-in. backOut overshoots slightly closer than park, then settles.
    { start: 9.8, end: 15, x: 0, y: 0, z: PARK_Z, rotX: -1.1, rotY: 1.8, rotZ: 0, opacity: 1, glow: 0.5, ease: "backOut" },
    // 15-21s: slow push through the conversation.
    { start: 15, end: 21, x: -40, y: -5, z: 1520, rotX: -0.6, rotY: 0.9, rotZ: 0, opacity: 1, glow: 0.3, ease: "smooth" },
    // 21-28s: focus shifts down the transcript.
    { start: 21, end: 28, x: 50, y: -18, z: 1490, rotX: 0.45, rotY: -1.1, rotZ: 0, opacity: 1, glow: 0.25, ease: "smooth" },
    // 28-34.2s: capability montage, flatter and quicker.
    { start: 28, end: 31.2, x: 70, y: -26, z: 1460, rotX: 0, rotY: -1.6, rotZ: 0, opacity: 1, glow: 0.35, ease: "out" },
    { start: 31.2, end: 34.2, x: -52, y: -12, z: 1620, rotX: -0.75, rotY: 1.5, rotZ: 0, opacity: 1, glow: 0.3, ease: "out" },
    { start: 34.2, end: 37.4, x: 30, y: 18, z: 1420, rotX: 0.85, rotY: -0.75, rotZ: -0.35, opacity: 1, glow: 0.4, ease: "out" },
    { start: 37.4, end: 42.4, x: -16, y: -6, z: 1570, rotX: -0.45, rotY: 0.45, rotZ: 0, opacity: 1, glow: 0.3, ease: "smooth" },
    // 42.4-52.4s: settings, then the light/dark reveal at the same framing so the
    // theme change is the only thing moving.
    { start: 42.4, end: 47.4, x: 0, y: 6, z: 1500, rotX: -0.25, rotY: 1.1, rotZ: 0, opacity: 1, glow: 0.5, ease: "smooth" },
    { start: 47.4, end: 51.6, x: 0, y: 0, z: 1390, rotX: 0, rotY: 0, rotZ: 0, opacity: 1, glow: 0.6, ease: "smooth" },
    // 51.6-55.4s: pull back and dissolve while the end card fades up over it
    // (from 53.4s), so the frame is never empty between the two.
    { start: 51.6, end: 55.4, x: 0, y: 6, z: 1520, rotX: 0, rotY: 0, rotZ: 0, opacity: 1, glow: 0.7, ease: "smooth" },
    { start: 55.4, end: 60.5, x: 0, y: 18, z: 2400, rotX: 0, rotY: 0, rotZ: 0, opacity: 0, glow: 0.9, ease: "smooth" }
  ];
  var SCENES = [
    {
      // Idle home screen while the camera is still far away.
      start: 9.6,
      apply(state) {
        state.view = "home";
        state.sidebarOpen = true;
        state.reviewOpen = true;
        state.typed = "";
        state.caretOn = true;
      }
    },
    {
      // Type the prompt, then "send" it as the camera lands.
      start: 11.4,
      apply(state, t) {
        state.view = "home";
        const full = CONVERSATION.userTurns[0];
        const p = ease("smooth", (t - 11.4) / 2.4);
        state.typed = full.slice(0, Math.round(full.length * p));
        state.caretOn = Math.floor(t * 2.2) % 2 === 0;
        state.sending = t > 13.9;
      }
    },
    {
      // The conversation, revealed top to bottom.
      start: 14.6,
      apply(state, t) {
        state.view = "workbench";
        state.typed = "";
        state.sending = false;
        const p = ease("smooth", (t - 14.6) / 11);
        state.revealUser = 0.1 + p * 0.9;
        state.thinkingShown = t > 16.6;
        state.toolOpen = ease("smooth", (t - 18.2) / 1.6);
        const answer = CONVERSATION.assistantTurns[1];
        const streamStart = 24.6;
        state.streamText = t > streamStart ? answer.slice(0, Math.round(answer.length * ease("out", (t - streamStart) / 2.6))) : "";
      }
    },
    {
      // Open the real diff in the review pane.
      start: 28.1,
      apply(state, t) {
        state.view = "workbench";
        state.revealUser = 1;
        state.streamText = "";
        state.toolOpen = 0;
        state.reviewTab = "changes";
        state.reviewOpen = true;
        state.diffOpen = ease("smooth", (t - 28.7) / 1.8);
      }
    },
    {
      // The plan tab.
      start: 31.3,
      apply(state, t) {
        state.reviewTab = "plan";
        state.diffOpen = 0;
        state.planProgress = ease("smooth", (t - 32.2) / 1.5);
      }
    },
    {
      // Integrated terminal.
      start: 34.3,
      apply(state, t) {
        state.view = "terminal";
        state.reviewTab = "changes";
        state.planProgress = 1;
        state.terminalLines = Math.min(7, 1 + Math.floor(ease("out", (t - 34.5) / 1.6) * 7));
      }
    },
    {
      // Command palette.
      start: 37.5,
      apply(state, t) {
        state.view = "palette";
        state.terminalLines = 7;
        const full = "\u8BBE\u7F6E";
        state.paletteQuery = full.slice(0, Math.round(full.length * ease("smooth", (t - 38.1) / 1.4)));
      }
    },
    {
      // Settings, held through the light/dark crossfade.
      start: 42.5,
      apply(state) {
        state.view = "settings";
        state.paletteQuery = "";
        state.reviewOpen = true;
        state.sidebarOpen = true;
      }
    },
    {
      // Back to the workbench for the closing beat under the end card.
      start: 50.4,
      apply(state) {
        state.view = "workbench";
        state.revealUser = 1;
        state.streamText = "";
        state.reviewOpen = true;
        state.reviewTab = "changes";
        state.diffOpen = 0;
        state.planProgress = 1;
      }
    }
  ];
  var THEME_SWEEP = { start: 45.4, end: 47.6 };
  function themeWipeAt(time) {
    return ease("smooth", (time - THEME_SWEEP.start) / (THEME_SWEEP.end - THEME_SWEEP.start));
  }
  function stateAt(time) {
    const state = initialState();
    for (const scene of SCENES) if (time >= scene.start) scene.apply(state, time);
    return state;
  }
  var SWEEPS = [
    { start: 12.4, end: 14.8, intensity: 0.9 },
    { start: 25.4, end: 27.6, intensity: 0.7 },
    { ...THEME_SWEEP, intensity: 1 },
    { start: 54.6, end: 56.6, intensity: 0.8 }
  ];
  function sweepAt(time) {
    for (const sweep of SWEEPS) {
      if (time >= sweep.start && time <= sweep.end) {
        return {
          progress: ease("smooth", (time - sweep.start) / (sweep.end - sweep.start)),
          intensity: sweep.intensity
        };
      }
    }
    return null;
  }
  var CUES = [
    { time: 0.4, kind: "pad-in" },
    { time: 1.1, kind: "draw" },
    // π stroke one
    { time: 1.8, kind: "draw" },
    // stroke two
    { time: 2.5, kind: "draw" },
    // stroke three
    { time: 3.8, kind: "riser", duration: 1.4 },
    { time: 4.6, kind: "whoosh", intensity: 0.5 },
    { time: 9.8, kind: "whoosh", intensity: 1 },
    { time: 11.4, kind: "typing", duration: 2.4 },
    { time: 14, kind: "send" },
    { time: 14.6, kind: "whoosh", intensity: 0.6 },
    { time: 14.75, kind: "land" },
    { time: 16.6, kind: "click" },
    { time: 18.2, kind: "expand" },
    { time: 24.6, kind: "typing", duration: 2.6 },
    { time: 27.6, kind: "success" },
    { time: 28.1, kind: "whoosh", intensity: 0.8 },
    { time: 28.8, kind: "expand" },
    { time: 31.3, kind: "whoosh", intensity: 0.6 },
    { time: 32.2, kind: "click" },
    { time: 33.6, kind: "success" },
    { time: 34.3, kind: "whoosh", intensity: 0.7 },
    { time: 34.6, kind: "terminal", duration: 1.6 },
    { time: 37.5, kind: "whoosh", intensity: 0.6 },
    { time: 38.1, kind: "typing", duration: 1.4 },
    { time: 40, kind: "click" },
    { time: 42.5, kind: "whoosh", intensity: 0.7 },
    { time: THEME_SWEEP.start, kind: "sweep", duration: THEME_SWEEP.end - THEME_SWEEP.start },
    { time: THEME_SWEEP.end, kind: "land" },
    { time: 51.6, kind: "whoosh", intensity: 0.9 },
    { time: 55, kind: "success" },
    { time: 57, kind: "finale" }
  ];

  // tools/promo/scene/audio.js
  var NOTE = { C2: 65.41, G2: 98, A2: 110, C3: 130.81, D3: 146.83, E3: 164.81, F3: 174.61, G3: 196, A3: 220, C4: 261.63, D4: 293.66, E4: 329.63, G4: 392, A4: 440, C5: 523.25, E5: 659.25, G5: 783.99 };
  function makeNoise(ctx, seconds2, seed = 1) {
    const length = Math.ceil(seconds2 * ctx.sampleRate);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let s = seed >>> 0;
    for (let i = 0; i < length; i += 1) {
      s = s * 1664525 + 1013904223 >>> 0;
      data[i] = s / 4294967295 * 2 - 1;
    }
    return buffer;
  }
  function tone(ctx, dest, { freq, at, duration, gain, type = "sine", attack = 5e-3, detune = 0, pan = 0 }) {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    osc.detune.value = detune;
    const env = ctx.createGain();
    env.gain.setValueAtTime(1e-4, at);
    env.gain.exponentialRampToValueAtTime(Math.max(2e-4, gain), at + attack);
    env.gain.exponentialRampToValueAtTime(1e-4, at + duration);
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    osc.connect(env).connect(panner).connect(dest);
    osc.start(at);
    osc.stop(at + duration + 0.05);
  }
  function noiseBurst(ctx, dest, noiseBuffer, { at, duration, gain, from, to, q = 1.2, type = "bandpass", attack = 0.02, pan = 0 }) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    src.loop = true;
    src.playbackRate.value = 1;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(from, at);
    filter.frequency.exponentialRampToValueAtTime(Math.max(40, to), at + duration);
    const env = ctx.createGain();
    env.gain.setValueAtTime(1e-4, at);
    env.gain.exponentialRampToValueAtTime(Math.max(2e-4, gain), at + attack);
    env.gain.exponentialRampToValueAtTime(1e-4, at + duration);
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    src.connect(filter).connect(env).connect(panner).connect(dest);
    src.start(at);
    src.stop(at + duration + 0.05);
  }
  function pad(ctx, dest, { at, duration, gain, root, chord, cutoffFrom, cutoffTo }) {
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.value = 0.7;
    filter.frequency.setValueAtTime(cutoffFrom, at);
    filter.frequency.linearRampToValueAtTime(cutoffTo, at + duration * 0.55);
    filter.frequency.linearRampToValueAtTime(cutoffFrom * 0.9, at + duration);
    const env = ctx.createGain();
    env.gain.setValueAtTime(1e-4, at);
    env.gain.linearRampToValueAtTime(gain, at + Math.min(2.2, duration * 0.3));
    env.gain.setValueAtTime(gain, at + duration * 0.7);
    env.gain.linearRampToValueAtTime(1e-4, at + duration);
    filter.connect(env).connect(dest);
    const freqs = [root, ...chord];
    for (const freq of freqs) {
      for (const detune of [-6, 6]) {
        const osc = ctx.createOscillator();
        osc.type = "sawtooth";
        osc.frequency.value = freq;
        osc.detune.value = detune;
        const voice = ctx.createGain();
        voice.gain.value = 0.5 / freqs.length;
        osc.connect(voice).connect(filter);
        osc.start(at);
        osc.stop(at + duration + 0.1);
      }
    }
    return { filter, env };
  }
  async function synthesize({ duration, sampleRate, channels, cues }) {
    const ctx = new OfflineAudioContext(channels, Math.ceil(duration * sampleRate), sampleRate);
    const master = ctx.createGain();
    master.gain.value = 0.62;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 22;
    comp.ratio.value = 3;
    comp.attack.value = 6e-3;
    comp.release.value = 0.22;
    master.connect(comp).connect(ctx.destination);
    const noise = makeNoise(ctx, 4, 12345);
    const sections = [
      { at: 0.2, duration: 12, root: NOTE.C2 * 2, chord: [NOTE.G3, NOTE.C4, NOTE.E4], cutoffFrom: 340, cutoffTo: 900, gain: 0.17 },
      { at: 12, duration: 16, root: NOTE.A2, chord: [NOTE.E3, NOTE.A3, NOTE.C4], cutoffFrom: 380, cutoffTo: 1100, gain: 0.18 },
      { at: 28, duration: 14, root: NOTE.F3 / 2, chord: [NOTE.C4, NOTE.F3, NOTE.A3], cutoffFrom: 420, cutoffTo: 1300, gain: 0.19 },
      { at: 42, duration: 11, root: NOTE.C3, chord: [NOTE.G3, NOTE.C4, NOTE.E4], cutoffFrom: 400, cutoffTo: 1500, gain: 0.2 },
      { at: 52.5, duration: 8, root: NOTE.F3 / 2, chord: [NOTE.A3, NOTE.C4, NOTE.E4], cutoffFrom: 460, cutoffTo: 1700, gain: 0.22 }
    ];
    for (const section of sections) pad(ctx, master, section);
    for (let t = 1; t < duration - 1; t += 2) {
      tone(ctx, master, { freq: NOTE.C2, at: t, duration: 0.9, gain: 0.09, type: "sine", attack: 0.02 });
    }
    for (const cue of cues) {
      switch (cue.kind) {
        case "pad-in":
          break;
        // the pad sections already handle this
        case "draw":
          noiseBurst(ctx, master, noise, { at: cue.time, duration: 0.36, gain: 0.09, from: 1800, to: 5200, q: 2.4, attack: 6e-3 });
          tone(ctx, master, { freq: NOTE.E5, at: cue.time, duration: 0.3, gain: 0.04, type: "sine" });
          break;
        case "riser":
          noiseBurst(ctx, master, noise, { at: cue.time, duration: cue.duration ?? 1.2, gain: 0.14, from: 260, to: 7e3, q: 1.1, attack: 0.5 });
          break;
        case "whoosh":
          noiseBurst(ctx, master, noise, { at: cue.time - 0.12, duration: 0.5, gain: 0.16 * (cue.intensity ?? 1), from: 7e3, to: 280, q: 1, attack: 0.01 });
          noiseBurst(ctx, master, noise, { at: cue.time - 0.1, duration: 0.34, gain: 0.1 * (cue.intensity ?? 1), from: 300, to: 4200, q: 1.6, attack: 0.12 });
          break;
        case "land":
          tone(ctx, master, { freq: 92, at: cue.time, duration: 0.5, gain: 0.3, type: "sine", attack: 4e-3 });
          tone(ctx, master, { freq: 138, at: cue.time + 0.01, duration: 0.34, gain: 0.12, type: "sine" });
          noiseBurst(ctx, master, noise, { at: cue.time, duration: 0.22, gain: 0.07, from: 4200, to: 900, q: 0.8, attack: 2e-3 });
          break;
        case "typing": {
          const steps = Math.max(4, Math.round((cue.duration ?? 2) * 7));
          for (let i = 0; i < steps; i += 1) {
            const at = cue.time + (cue.duration ?? 2) * i / steps + i * 37 % 11 / 200;
            noiseBurst(ctx, master, noise, { at, duration: 0.045, gain: 0.05, from: 2600, to: 6200, q: 1.5, attack: 2e-3, pan: (i % 3 - 1) * 0.25 });
          }
          break;
        }
        case "send":
          tone(ctx, master, { freq: NOTE.E5, at: cue.time, duration: 0.18, gain: 0.14, type: "triangle", attack: 3e-3 });
          tone(ctx, master, { freq: NOTE.A4, at: cue.time + 0.05, duration: 0.22, gain: 0.1, type: "sine" });
          break;
        case "click":
          tone(ctx, master, { freq: 1180, at: cue.time, duration: 0.055, gain: 0.09, type: "square", attack: 1e-3 });
          noiseBurst(ctx, master, noise, { at: cue.time, duration: 0.03, gain: 0.05, from: 5e3, to: 2200, q: 1, attack: 1e-3 });
          break;
        case "expand":
          noiseBurst(ctx, master, noise, { at: cue.time, duration: 0.28, gain: 0.08, from: 900, to: 3400, q: 1.4, attack: 0.03 });
          tone(ctx, master, { freq: NOTE.D4, at: cue.time, duration: 0.2, gain: 0.06, type: "sine" });
          break;
        case "terminal":
          for (let i = 0; i < 9; i += 1) {
            noiseBurst(ctx, master, noise, { at: cue.time + i * 0.16, duration: 0.03, gain: 0.045, from: 3400, to: 5200, q: 2, attack: 1e-3, pan: -0.3 });
          }
          break;
        case "success":
          [NOTE.C4, NOTE.E4, NOTE.G4].forEach((freq, index) => {
            tone(ctx, master, { freq, at: cue.time + index * 0.07, duration: 0.6 - index * 0.1, gain: 0.11, type: "sine", attack: 0.012 });
          });
          break;
        case "sweep":
          noiseBurst(ctx, master, noise, { at: cue.time, duration: cue.duration ?? 3, gain: 0.1, from: 400, to: 5200, q: 0.9, attack: 1 });
          tone(ctx, master, { freq: NOTE.G4, at: cue.time + 1.4, duration: 1.6, gain: 0.06, type: "sine", attack: 0.6 });
          break;
        case "finale":
          [NOTE.C4, NOTE.E4, NOTE.G4, NOTE.C5].forEach((freq, index) => {
            tone(ctx, master, { freq, at: cue.time + index * 0.11, duration: 2.4 - index * 0.25, gain: 0.1, type: "sine", attack: 0.05 });
          });
          tone(ctx, master, { freq: 52, at: cue.time + 0.5, duration: 2.2, gain: 0.26, type: "sine", attack: 0.06 });
          break;
        default:
          break;
      }
    }
    const rendered = await ctx.startRendering();
    const left = rendered.getChannelData(0);
    const right = rendered.numberOfChannels > 1 ? rendered.getChannelData(1) : left;
    const out = new Float32Array(left.length * channels);
    for (let i = 0; i < left.length; i += 1) {
      const l = Math.tanh(left[i] * 0.9);
      const r = Math.tanh(right[i] * 0.9);
      if (channels === 1) out[i] = (l + r) / 2;
      else {
        out[i * 2] = l;
        out[i * 2 + 1] = r;
      }
    }
    return out;
  }

  // tools/promo/scene/app.js
  var FPS = 60;
  var SAMPLE_RATE = 48e3;
  var CHANNELS = 2;
  var WINDOW_RADIUS = 12;
  var params = new URLSearchParams(location.search);
  var seconds = Number(params.get("seconds")) || DURATION;
  var appCanvas = document.createElement("canvas");
  appCanvas.width = WINDOW.width;
  appCanvas.height = WINDOW.height;
  var appCtx = appCanvas.getContext("2d", { alpha: false });
  var darkCanvas = document.createElement("canvas");
  darkCanvas.width = WINDOW.width;
  darkCanvas.height = WINDOW.height;
  var darkCtx = darkCanvas.getContext("2d");
  var WIPE_SOFTNESS = 90;
  function drawThemeWipe(state, progress) {
    drawApp(appCtx, LIGHT, state);
    drawApp(darkCtx, DARK, state);
    const cx = sweepCenter(0, WINDOW.width, progress);
    const len = Math.hypot(1, SWEEP_SLANT);
    const nx = 1 / len;
    const ny = SWEEP_SLANT / len;
    const mask = darkCtx.createLinearGradient(
      cx - nx * WIPE_SOFTNESS,
      -ny * WIPE_SOFTNESS,
      cx + nx * WIPE_SOFTNESS,
      ny * WIPE_SOFTNESS
    );
    mask.addColorStop(0, "rgba(0,0,0,1)");
    mask.addColorStop(1, "rgba(0,0,0,0)");
    darkCtx.save();
    darkCtx.globalCompositeOperation = "destination-in";
    darkCtx.fillStyle = mask;
    darkCtx.fillRect(0, 0, WINDOW.width, WINDOW.height);
    darkCtx.restore();
    appCtx.drawImage(darkCanvas, 0, 0);
  }
  var roundedCanvas = document.createElement("canvas");
  roundedCanvas.width = WINDOW.width;
  roundedCanvas.height = WINDOW.height;
  var roundedCtx = roundedCanvas.getContext("2d");
  function logoAlphaAt(time) {
    if (time < 4.2) return 1;
    return Math.max(0, 1 - (time - 4.2) / 1.2);
  }
  var CAPTION_SECONDS = 2.7;
  function captionAt(time) {
    for (const caption of COPY.captions) {
      const local = time - caption.time;
      if (local < 0 || local > CAPTION_SECONDS) continue;
      const fadeIn = ease("out", Math.min(1, local / 0.35));
      const fadeOut = ease("out", Math.min(1, Math.max(0, (CAPTION_SECONDS - local) / 0.5)));
      return { text: caption.text, alpha: Math.min(fadeIn, fadeOut) };
    }
    return null;
  }
  function drawFrameAt(ctx, time) {
    const wipe = themeWipeAt(time);
    const state = stateAt(time);
    const pose = poseAt(SHOTS, time);
    if (wipe <= 0) drawApp(appCtx, LIGHT, state);
    else if (wipe >= 1) drawApp(appCtx, DARK, state);
    else drawThemeWipe(state, wipe);
    roundedCtx.clearRect(0, 0, WINDOW.width, WINDOW.height);
    roundedCtx.save();
    roundedCtx.beginPath();
    const r = WINDOW_RADIUS;
    roundedCtx.moveTo(r, 0);
    roundedCtx.arcTo(WINDOW.width, 0, WINDOW.width, WINDOW.height, r);
    roundedCtx.arcTo(WINDOW.width, WINDOW.height, 0, WINDOW.height, r);
    roundedCtx.arcTo(0, WINDOW.height, 0, 0, r);
    roundedCtx.arcTo(0, 0, WINDOW.width, 0, r);
    roundedCtx.closePath();
    roundedCtx.clip();
    roundedCtx.drawImage(appCanvas, 0, 0);
    roundedCtx.restore();
    drawStage(ctx, time);
    const showWindow = pose.opacity > 4e-3;
    if (showWindow) {
      const quad = projectQuad(pose, time);
      const bounds = quadBounds(quad);
      drawWindowGlow(ctx, { ...bounds, scale: bounds.width / WINDOW.width }, pose.glow ?? 0);
      const shadowQuad = quad.map((p) => ({ x: p.x + 6, y: p.y + 26 * (bounds.width / WINDOW.width) }));
      ctx.save();
      ctx.globalAlpha = 0.55 * (pose.opacity ?? 1);
      ctx.filter = `blur(${Math.max(6, 26 * (bounds.width / WINDOW.width))}px)`;
      ctx.fillStyle = "rgba(0,0,0,.55)";
      ctx.beginPath();
      ctx.moveTo(shadowQuad[0].x, shadowQuad[0].y);
      for (let i = 1; i < 4; i += 1) ctx.lineTo(shadowQuad[i].x, shadowQuad[i].y);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      drawQuad(ctx, roundedCanvas, quad, pose.opacity ?? 1);
      ctx.save();
      ctx.globalAlpha = 0.5 * (pose.opacity ?? 1);
      ctx.strokeStyle = "rgba(255,255,255,.14)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(quad[0].x, quad[0].y);
      for (let i = 1; i < 4; i += 1) ctx.lineTo(quad[i].x, quad[i].y);
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
      const sweep = sweepAt(time);
      if (sweep) drawLightSweep(ctx, bounds, sweep.progress, sweep.intensity);
    }
    const caption = captionAt(time);
    if (caption) drawCaption(ctx, caption.text, caption.alpha);
    const logoAlpha = logoAlphaAt(time);
    if (logoAlpha > 4e-3) {
      drawLogo(ctx, FRAME.width / 2, FRAME.height / 2, 150, ease("smooth", time / 3.2), "#EFEFE7", "#262827", logoAlpha);
    }
    if (time > 53.4) {
      const p = ease("smooth", (time - 53.4) / 2);
      drawEndCard(ctx, time, {
        logoProgress: 1,
        logoAlpha: p,
        textAlpha: ease("smooth", Math.max(0, (time - 55) / 1.6)),
        glow: p
      });
    }
    drawVignette(ctx, 1);
    drawFrame(ctx);
  }
  async function pickVideoConfig() {
    const candidates = [
      { codec: "avc1.64002a", width: FRAME.width, height: FRAME.height, bitrate: 14e6, framerate: FPS, avc: { format: "avc" } },
      { codec: "avc1.640028", width: FRAME.width, height: FRAME.height, bitrate: 12e6, framerate: FPS, avc: { format: "avc" } }
    ];
    for (const candidate of candidates) {
      const { supported, config } = await VideoEncoder.isConfigSupported(candidate);
      if (supported) return config ?? candidate;
    }
    throw new Error("no supported H.264 config");
  }
  async function run() {
    const log = [];
    const started = performance.now();
    const videoConfig = await pickVideoConfig();
    log.push(`video: ${videoConfig.codec} @ ${(videoConfig.bitrate / 1e6).toFixed(1)} Mbps`);
    const audioConfig = { codec: "mp4a.40.2", sampleRate: SAMPLE_RATE, numberOfChannels: CHANNELS, bitrate: 192e3 };
    if (!(await AudioEncoder.isConfigSupported(audioConfig)).supported) throw new Error("AAC unsupported");
    const muxer = new Muxer({
      target: new ArrayBufferTarget(),
      video: { codec: "avc", width: FRAME.width, height: FRAME.height, frameRate: FPS },
      audio: { codec: "aac", numberOfChannels: CHANNELS, sampleRate: SAMPLE_RATE },
      fastStart: "in-memory"
    });
    const videoEncoder = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: (error) => {
        throw error;
      }
    });
    videoEncoder.configure(videoConfig);
    const audioEncoder = new AudioEncoder({
      output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
      error: (error) => {
        throw error;
      }
    });
    audioEncoder.configure(audioConfig);
    const canvas = document.createElement("canvas");
    canvas.width = FRAME.width;
    canvas.height = FRAME.height;
    const ctx = canvas.getContext("2d", { alpha: false });
    const totalFrames = Math.round(seconds * FPS);
    const frameDuration = 1e6 / FPS;
    const videoStarted = performance.now();
    for (let i = 0; i < totalFrames; i += 1) {
      drawFrameAt(ctx, i / FPS);
      const frame = new VideoFrame(canvas, {
        timestamp: Math.round(i * frameDuration),
        duration: Math.round(frameDuration)
      });
      videoEncoder.encode(frame, { keyFrame: i % (FPS * 2) === 0 });
      frame.close();
      if (videoEncoder.encodeQueueSize > 10) {
        await new Promise((resolve) => {
          const check = () => videoEncoder.encodeQueueSize <= 5 ? resolve() : setTimeout(check, 3);
          check();
        });
      }
    }
    log.push(`video frames: ${totalFrames} in ${((performance.now() - videoStarted) / 1e3).toFixed(1)}s`);
    await videoEncoder.flush();
    videoEncoder.close();
    const audioStarted = performance.now();
    const pcm = await synthesize({ duration: seconds, sampleRate: SAMPLE_RATE, channels: CHANNELS, cues: CUES });
    const totalAudioFrames = pcm.length / CHANNELS;
    const CHUNK = 1024;
    for (let offset = 0; offset < totalAudioFrames; offset += CHUNK) {
      const count = Math.min(CHUNK, totalAudioFrames - offset);
      const data = new AudioData({
        format: "f32",
        sampleRate: SAMPLE_RATE,
        numberOfFrames: count,
        numberOfChannels: CHANNELS,
        timestamp: Math.round(offset / SAMPLE_RATE * 1e6),
        data: pcm.subarray(offset * CHANNELS, (offset + count) * CHANNELS)
      });
      audioEncoder.encode(data);
      data.close();
      if (audioEncoder.encodeQueueSize > 24) {
        await new Promise((resolve) => {
          const check = () => audioEncoder.encodeQueueSize <= 12 ? resolve() : setTimeout(check, 3);
          check();
        });
      }
    }
    await audioEncoder.flush();
    audioEncoder.close();
    log.push(`audio frames: ${totalAudioFrames} in ${((performance.now() - audioStarted) / 1e3).toFixed(1)}s`);
    muxer.finalize();
    const bytes2 = new Uint8Array(muxer.target.buffer);
    log.push(`mp4: ${(bytes2.byteLength / 1024 / 1024).toFixed(2)} MB`);
    await fetch("/save?name=video", { method: "POST", body: bytes2 });
    log.push(`total: ${((performance.now() - started) / 1e3).toFixed(1)}s`);
    return log;
  }
  async function still(times) {
    const canvas = document.createElement("canvas");
    canvas.width = FRAME.width;
    canvas.height = FRAME.height;
    const ctx = canvas.getContext("2d", { alpha: false });
    const log = [];
    for (const time of times) {
      drawFrameAt(ctx, time);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      const bytes2 = new Uint8Array(await blob.arrayBuffer());
      await fetch(`/save?name=${encodeURIComponent(`still-${time.toFixed(1)}s`)}`, { method: "POST", body: bytes2 });
      log.push(`still ${time}s -> ${(bytes2.byteLength / 1024).toFixed(0)} KB`);
    }
    return log;
  }
  window.__smoke = () => params.has("still") ? still(params.get("still").split(",").map(Number)) : run();
  window.__smokeReady = true;
})();
