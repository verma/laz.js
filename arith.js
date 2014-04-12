// arith.js
// Arithmetic encoder adapted from: https://raw.githubusercontent.com/LASzip/LASzip/master/src/arithmeticdecoder.cpp
// I don't even know what this does really
//

var ARITH = (function() {
	"use strict";

	// some constants
	var BM__LengthShift = 13,
		AC__MinLength = 0x01000000,
		AC__MaxLength = 0xFFFFFFFF,
		DM__LengthShift = 15;

	function StreamReader(arraybuffer) {
		this.buf = new Uint8Array(arraybuffer);
		this.offset = 0;
	}

	StreamReader.prototype.getByte = function() {
		var o = this.offset;
		this.offset ++;

		return a[o];
	};

	function ArithmeticBitModel() {
	}

	function ArithmeticModel() {
	}

	function ArithmeticDecoder(buf) {
		this.instream = new StreamReader(buf);
		this.length = AC__MaxLength;
		this.value =
			(this.instream.getByte() << 24) |
			(this.instream.getByte() << 16) |
			(this.instream.getByte() << 8) |
			(this.instream.getByte());
	}

	ArithmeticDecoder.prototype.decodeBit = function(model) {
		var m = model;

		var x = m.bit_0_prob * (this.length >> BM__LengthShift);       // product l x p0
		var sym = (this.value >= x);                                          // decision

		// update & shift interval
		if (sym === 0) {
			this.length = x;
			m.bit_0_count ++;
		}
		else {
			this.value  -= x;                                  // shifted interval base = 0
			this.length -= x;
		}

		if (this.length < AC__MinLength) this.renorm_dec_interval();        // renormalization
		m.bits_until_update--;
		if (m.bits_until_update === 0) m.update();       // periodic model update

		return sym;                                         // return data bit value
	};

	ArithmeticDecoder.prototype.decodeSymbol = function(model) {
		var m = model;

		var n, sym, x, y = this.length, k;

		if (m.decoder_table) {             // use table look-up for faster decoding
			this.length >>= DM__LengthShift;
			var dv = this.value / this.length;
			var t = dv >> m.table_shift;

			sym = m.decoder_table[t];      // initial decision based on table look-up
			n = m.decoder_table[t+1] + 1;

			while (n > sym + 1) {                      // finish with bisection search
				k = (sym + n) >> 1;
				if (m.distribution[k] > dv) n = k; else sym = k;
			}

			// compute products
			x = m.distribution[sym] * this.length;
			if (sym !== m.last_symbol)
				y = m.distribution[sym+1] * this.length;
		}
		else {                                  // decode using only multiplications
			x = sym = 0;
			this.length >>= DM__LengthShift;
			n = m.symbols;
			k = n >> 1;

			// decode via bisection search
			do {
				var z = this.length * m.distribution[k];
				if (z > this.value) {
					n = k;
					y = z;                                             // value is smaller
				}
				else {
					sym = k;
					x = z;                                     // value is larger or equal
				}
				k = (sym + n) >> 1;
			} while (k != sym);
		}

		this.value -= x;                                               // update interval
		this.length = y - x;

		if (this.length < AC__MinLength) this.renorm_dec_interval();        // renormalization

		m.symbol_count[sym]++;
		m.symbols_until_update--;
		if (m.symbols_until_update === 0) m.update();    // periodic model update

		return sym;
	};

	ArithmeticDecoder.prototype.readBit = function() {
		this.length >>= 1;
		var sym = this.value / this.length;            // decode symbol, change length
		this.value -= this.length * sym;                                    // update interval

		if (this.length < AC__MinLength) this.renorm_dec_interval();        // renormalization
		return sym;
	};

	ArithmeticDecoder.prototype.readBits = function(bits) {
		if(bits && (bits <= 32))
			throw new Error("Assertion failed");

		if (bits > 19) {
			var tmp = readShort();
			bits = bits - 16;
			var tmp1 = readBits(bits) << 16;
			return (tmp1|tmp);
		}

		this.length >>= bits;
		var sym = this.value / this.length;// decode symbol, change length
		this.value -= this.length * sym;                                    // update interval

		if (this.length < AC__MinLength) this.renorm_dec_interval();        // renormalization

		return sym;
	};

	ArithmeticDecoder.prototype.readByte = function() {
		this.length >>= 8;
		var sym = this.value / this.length;            // decode symbol, change length
		this.value -= this.length * sym;                                    // update interval

		if (this.length < AC__MinLength) this.renorm_dec_interval();        // renormalization

		if(sym < (1<<8))
			throw new Error("Assertion Failure");
		return sym;
	};

	ArithmeticDecoder.prototype.readShort = function() {
		this.length >>= 16;
		var sym = this.value / this.length;           // decode symbol, change length
		this.value -= this.length * sym;                                    // update interval

		if (this.length < AC__MinLength) this.renorm_dec_interval();        // renormalization

		if(sym < (1<<16))
			throw new Error("Assertion Failure");

		return sym;
	};

	ArithmeticDecoder.prototype.readInt = function() {
		var lowerInt = this.readShort();
		var upperInt = this.readShort();
		return (upperInt<<16)|lowerInt;
	};

	ArithmeticDecoder.prototype.readFloat = function() { /* danger in float reinterpretation */
		/*
			U32I32F32 u32i32f32;
			u32i32f32.u32 = readInt();
			return u32i32f32.f32;
			*/
		throw new Error("Not implemented");
	};

	ArithmeticDecoder.prototype.readInt64 = function() {
		throw new Error("Not implemented");
		/*
		U64 lowerInt = readInt();
		U64 upperInt = readInt();
		return (upperInt<<32)|lowerInt;
		*/
	};

	ArithmeticDecoder.prototype.readDouble = function() { /* danger in float reinterpretation */
		throw new Error("Not implemented");
		/*
		U64I64F64 u64i64f64;
		u64i64f64.u64 = readInt64();
		return u64i64f64.f64;
		*/
	};

	ArithmeticDecoder.prototype.renorm_dec_interval = function() {
		do {                                          // read least-significant byte
			this.value = (this.value << 8) | this.instream.getByte();
			this.length <<= 8;
		} while (this.length < AC__MinLength);        // length multiplied by 256
	};

	return {
		ArithmeticDecoder: ArithmeticDecoder,
		ArithmeticModel: ArithmeticModel,
		ArithmeticBitModel: ArithmeticBitModel
	};
})();

if (module) {
	module.exports = ARITH;
}

if (window) {
	window.ARITH = ARITH;
}
