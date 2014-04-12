var fs = require('fs'),

	_ = require('lodash');


var LAZ = (function() {
	"use strict";
	function readAs(buf, Type, offset, count) {
		count = (count === undefined || count === 0 ? 1 : count);
		var sub = buf.slice(offset, offset + Type.BYTES_PER_ELEMENT * count);

		var r = new Type(sub);
		if (count === undefined || count === 1)
			return r[0];

		var ret = [];
		for (var i = 0 ; i < count ; i ++) {
			ret.push(r[i]);
		}

		return ret;
	}

	function readString(buf, start, length) {
		var sub = buf.slice(start, start + length);
		var s = "";
		for (var i = 0 ; i < sub.byteLength ; i ++) {
			var c = String.fromCharCode(sub[i]);
			if (c !== '\u0000')
				s += c;
		}
		return s.toString('utf-8');
	}

	function readAs64(buf, offset) {
		/*
		var sub = readAs(buf, Uint8Array, offset, 4);

		var lower = ((sub[3] & 0xFF) << 24) | ((sub[2] & 0xFF) << 16) | ((sub[1] & 0xFF) << 8) | (sub[0] & 0xFF);
		sub = new Uint8Array(buf.slice(offset + 4, offset + 8)); 
		var higher = ((sub[3] & 0xFF) << 24) | ((sub[2] & 0xFF) << 16) | ((sub[1] & 0xFF) << 8) | (sub[0] & 0xFF);

		// if we cannot fit our 64bit numbers in 32bits, bail now
		if (higher > 0)
			throw new Error('There seems to be 64-bit values in use, not supported yet');

		return lower;
		*/
		return 0;
	}

	var LAZFile = function(arraybuffer) {
		this.arraybuffer = arraybuffer;

		this.determineVersion();
		if (this.version > 12)
			throw new Error("Only file versions <= 1.2 are supported at this time");

		this.determineFormat();
		if (!this.isCompressed)
			throw new Error("The file doesn't seem to be compressed");

		this.header = this.readHeader();
		this.checkForLAZ();

		this.lazHeader = this.lazInfo();
		this.checkLAZCompat();
	};

	LAZFile.prototype.determineFormat = function() {
		var formatId = readAs(this.arraybuffer, Uint8Array, 32*3+8);
		var bit_7 = (formatId & 0x80) >> 7;
		var bit_6 = (formatId & 0x40) >> 6;

		if (bit_7 === 1 && bit_6 === 1)
			throw new Error("Old style compression not supported");

		this.formatId = formatId & 0x3f;
		this.isCompressed = (bit_7 === 1 || bit_6 === 1);
	};

	LAZFile.prototype.determineVersion = function() {
		var ver = new Int8Array(this.arraybuffer, 24, 2);
		this.version = ver[0] * 10 + ver[1];
		this.versionAsString = ver[0] + "." + ver[1];
	};

	LAZFile.prototype.checkForLAZ = function() {
		var hasLAZ = this.header.vlrs.some(function(v) {
			return v.userId.indexOf('laszip encoded') === 0;
		});

		if (!hasLAZ)
			throw new Error('LASzip VLR was not found');
	};

	LAZFile.prototype.lazInfo = function() {
		var lazVLR = _.find(this.header.vlrs, function(v) {
			return v.userId.indexOf('laszip encoded') === 0;
		});

		var ab = this.arraybuffer.slice(lazVLR.recordFileOffset, lazVLR.recordFileOffset + lazVLR.recordLength);

		var lazItemsHeader = {
			compressor: readAs(ab, Uint16Array, 0),
			coder: readAs(ab, Uint16Array, 2),
			versionMajor: readAs(ab, Uint8Array, 4),
			versionMinor: readAs(ab, Uint8Array, 5),
			versionRev: readAs(ab, Uint16Array, 6),
			options: readAs(ab, Uint32Array, 8),
			chunkSize: readAs(ab, Uint32Array, 12),
			numPoints: 0, // in LASzip code these two vars are referred to as some offsets into EVLRs
			numBytes: 0
		};

		var numItems = readAs(ab, Uint16Array, 32);
		var typeNames = [ 'BYTE', 'SHORT', 'INT', 'LONG', 'FLOAT', 'DOUBLE', 'POINT10', 'GPSTIME11', 'RGB12', 'WAVEPACKET13', 'POINT14', 'RGBNIR14'];
		lazItemsHeader.items = _.times(numItems, function(i) {
			var t = readAs(ab, Uint16Array, 34 + i * 6);
			return {
				type: t,
				size: readAs(ab, Uint16Array, 34 + i * 6 + 2),
				version: readAs(ab, Uint16Array, 34 + i * 6 + 4),
				typeName: typeNames[t]
			};
		});

		return lazItemsHeader;
	};

	LAZFile.prototype.checkLAZCompat = function() {
		// make sure we support whatever this file asks us for
		_.forEach(this.lazHeader.items, function(i) {
			if (i.type > 8)
				throw new Error("Once of the LAZ compressed items is not supported yet: " + i.typeName);
		});
	};

	LAZFile.prototype.readHeader = function() {
		var o = {};
		var arraybuffer = this.arraybuffer;

		o.pointsOffset = readAs(arraybuffer, Uint32Array, 32*3);
		o.vlrsCount = readAs(arraybuffer, Uint32Array, 32*3+4);
		o.pointsFormatId = readAs(arraybuffer, Uint8Array, 32*3+8);
		o.pointsStructSize = readAs(arraybuffer, Uint16Array, 32*3+8+1);
		o.pointsCount = readAs(arraybuffer, Uint32Array, 32*3 + 11);


		var start = 32*3 + 35;
		o.scale = readAs(arraybuffer, Float64Array, start, 3); start += 24; // 8*3
		o.offset = readAs(arraybuffer, Float64Array, start, 3); start += 24;


		var bounds = readAs(arraybuffer, Float64Array, start, 6); start += 48; // 8*6;
		o.maxs = [bounds[0], bounds[2], bounds[4]];
		o.mins = [bounds[1], bounds[3], bounds[5]];

		o.headerSize = readAs(arraybuffer, Uint16Array, 32*3-2);
		var offset = o.headerSize;
		var vlrs = [];
		for (var i = 0 ; i < o.vlrsCount ; i ++) {
			var rl = readAs(arraybuffer, Uint16Array, offset + 20);

			vlrs.push({
				userId: readString(arraybuffer, offset + 2, 16),
				recordId: readAs(arraybuffer, Uint16Array, offset + 18),
				recordLength: rl,
				recordFileOffset: offset + 54,
				description: readString(arraybuffer, offset + 22, 32)
			});

			offset += 54 + rl;
		}

		o.vlrs = vlrs;
		
		return o;
	};

	return {
		LAZFile: LAZFile
	};
})();


process.nextTick(function() {
	fs.readFile(process.argv[2], function(err, data) {
		function toArrayBuffer(buffer) {
			var ab = new ArrayBuffer(buffer.length);
			var view = new Uint8Array(ab);
			for (var i = 0; i < buffer.length; ++i) {
				view[i] = buffer[i];
			}
			return ab;
		}

		var l = new LAZ.LAZFile(toArrayBuffer(data));

		console.log("File header:");
		console.log("---------------------------------------------");
		console.log(l.header);
		console.log("");
		console.log("LAZ VLR:");
		console.log("---------------------------------------------");
		console.log(l.lazHeader);
		console.log("");
	});
});
