import { Schema, model, models } from "mongoose";

const usageEventSchema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    workspaceId: { type: String, required: true, index: true },
    eventType: {
      type: String,
      required: true,
      enum: [
        "app_opened",
        "chat_requested",
        "document_indexed",
        "research_generated",
        "roadmap_generated",
        "analysis_generated",
      ],
    },
    payload: { type: Schema.Types.Mixed, default: {} },
    createdAt: { type: Date, default: Date.now, index: true },
  },
  {
    versionKey: false,
    collection: "usage_events",
  },
);

export const UsageEventModel =
  models.UsageEvent || model("UsageEvent", usageEventSchema);
