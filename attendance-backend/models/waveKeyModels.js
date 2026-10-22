const mongoose = require("mongoose");

// A short-lived key for one wave of one session. Wave 0 is played by the
// teacher's phone; keys rotate by adding a new document when one expires.
const waveKeySchema = new mongoose.Schema(
  {
    session: { type: mongoose.Schema.Types.ObjectId, ref: "AttendanceSession", required: true },
    wave: { type: Number, required: true, min: 0 },
    value: { type: Number, required: true },
    validFrom: { type: Date, required: true },
    validUntil: { type: Date, required: true },
  },
  { timestamps: true }
);

waveKeySchema.index({ session: 1, wave: 1, validUntil: -1 });
waveKeySchema.index({ session: 1, value: 1 });

module.exports = mongoose.model("WaveKey", waveKeySchema);
