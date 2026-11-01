package protocol

const (
	CodeUnauthorized            = "unauthorized"
	CodeForbidden               = "forbidden"
	CodeInvalidRequest          = "invalid_request"
	CodeNotFound                = "not_found"
	CodeConflict                = "conflict"
	CodePayloadTooLarge         = "payload_too_large"
	CodePairingCodeInvalid      = "pairing_code_invalid"
	CodePairingCodeUsed         = "pairing_code_used"
	CodePairingCodeExpired      = "pairing_code_expired"
	CodePairingChallengeInvalid = "pairing_challenge_invalid"
	CodePairingChallengeExpired = "pairing_challenge_expired"
	CodePairingAlreadyCompleted = "pairing_already_completed"
	CodeDeviceOffline           = "device_offline"
	CodeCommandTimeout          = "command_timeout"
	CodeCommandFailed           = "command_failed"
	CodeRequestInFlight         = "request_in_flight"
	CodeIdempotencyConflict     = "idempotency_conflict"
	CodeMethodNotSupported      = "method_not_supported"
	CodeInteractionNotFound     = "interaction_not_found"
	CodeInteractionExpired      = "interaction_expired"
	CodeInteractionDecided      = "interaction_decided"
	CodeInteractionInvalid      = "interaction_invalid"
	CodeSlowConsumer            = "slow_consumer"
	CodeFollowSuperseded        = "follow_superseded"
	CodeInternalError           = "internal_error"
)

func NewError(code, message string, retryable bool) Error {
	return Error{Code: code, Message: message, Retryable: retryable}
}
