package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

// SessionAttachment caches one file a DSH Session declared for delivery.
//
// Rows are learned from Connector transcript responses: the Server never trusts
// a phone-supplied path, and the row carries the desktop device, session and
// workspace identity used for every later authorization check. The filesystem
// path itself is never persisted here.
type SessionAttachment struct {
	ent.Schema
}

func (SessionAttachment) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").
			Unique().
			NotEmpty().
			Immutable().
			Comment("Opaque attachment id, e.g. att_xxx; carries no path"),
		field.String("device_id").
			NotEmpty().
			Comment("Desktop Connector device that declared the file"),
		field.String("mobile_device_id").
			Optional().
			Immutable().
			Comment("Phone that staged an upload; empty for desktop declarations"),
		field.String("session_id").
			NotEmpty(),
		field.String("workspace_id").
			NotEmpty(),
		field.Enum("source").
			Values("deliverable", "message", "tool", "upload").
			Comment("deliverable|message|tool describe desktop files; upload is a phone upload staged for one prompt"),
		field.Int64("source_seq").
			Comment("Session event sequence that declared the file"),
		field.Int("source_index").
			Comment("Position inside that event, e.g. files[i]"),
		field.Enum("kind").
			Values("image", "file").
			Default("file"),
		field.String("display_name").
			NotEmpty().
			Comment("Display name only; never a path"),
		field.String("mime").
			NotEmpty(),
		field.Int64("bytes").
			Default(0),
		field.String("sha256").
			Optional().
			Comment("Digest reported by the Connector when bytes were uploaded"),
		field.String("description").
			Optional(),
		field.Enum("state").
			Values("known", "fetching", "ready", "failed", "unavailable").
			Default("known"),
		field.String("error_code").
			Optional(),
		field.Time("created_at").
			Immutable().
			Default(time.Now),
		field.Time("updated_at").
			Default(time.Now).
			UpdateDefault(time.Now),
		field.Time("expires_at"),
	}
}

func (SessionAttachment) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("device_id", "session_id"),
		index.Fields("state"),
		index.Fields("expires_at"),
	}
}
