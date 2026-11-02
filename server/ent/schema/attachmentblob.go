package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

// AttachmentBlob is one content-addressed file stored on the Server. Bytes live
// outside PostgreSQL (see DSH_CONNECT_ATTACHMENT_DIR); this row is the durable
// index and identity used for dedupe and retention.
type AttachmentBlob struct {
	ent.Schema
}

func (AttachmentBlob) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").
			Unique().
			NotEmpty().
			Immutable().
			Comment("SHA-256 hex of the stored bytes"),
		field.String("mime").
			NotEmpty(),
		field.Int64("bytes"),
		field.String("storage_path").
			NotEmpty().
			Comment("Content-addressed path under DSH_CONNECT_ATTACHMENT_DIR"),
		field.Time("created_at").
			Immutable().
			Default(time.Now),
		field.Time("last_used_at").
			Default(time.Now),
	}
}

func (AttachmentBlob) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("last_used_at"),
	}
}
