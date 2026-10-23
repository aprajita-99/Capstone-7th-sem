const mongoose = require("mongoose");

// Private identity images (ID card, pending live selfie, reference face).
// Served only to the student and their teachers via GET /media/:mediaId.
const identityMediaSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    kind: { type: String, enum: ["id_card", "selfie", "reference_face"], required: true },
    contentType: { type: String, required: true },
    data: { type: Buffer, required: true },
    size: { type: Number, required: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("IdentityMedia", identityMediaSchema);
