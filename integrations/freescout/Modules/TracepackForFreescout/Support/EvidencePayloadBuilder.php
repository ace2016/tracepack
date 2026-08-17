<?php

namespace Modules\TracepackForFreescout\Support;

/**
 * Builds a tracepack-evidence v1 payload from plain arrays. Deliberately has no dependency on
 * Laravel, Eloquent, or FreeScout's own models. See PRODUCER_GUIDE.md and SPEC.md in
 * packages/evidence-interchange for the schema this implements. Kept framework-free so it can be
 * unit tested with a bare `php` CLI, the same way the payload it produces is checked against the
 * real @tracepack/evidence-sdk validator in this module's own test script.
 *
 * Only the four MIME types the schema accepts (application/pdf, image/jpeg, image/png,
 * image/webp) are eligible to become attachments; everything else is described in an
 * observation instead of silently dropped, so an agent attaching a .docx or .eml file still
 * sees it show up as text on the customer's side, not just vanish.
 */
final class EvidencePayloadBuilder
{
    public const SUPPORTED_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

    /**
     * @param array{id: string, mimeType: string, filename: string, bytes: string} $attachments
     *   `bytes` is the raw, undecoded binary file content, not base64.
     * @param array{author: string, body: string, sentAt: string} $threads Plain-text conversation
     *   messages in chronological order, oldest first. HTML thread bodies should already be
     *   stripped to text by the caller. This class does not know about FreeScout's own markup.
     */
    public static function build(
        string $producerId,
        string $producerName,
        ?string $producerVersion,
        string $sourceUrl,
        string $conversationSubject,
        string $customerEmail,
        array $threads,
        array $attachments,
        string $captureTimestamp,
        ?string $externalReference = null,
    ): array {
        $observations = [];
        $obsIndex = 1;

        $observations[] = [
            'id' => 'obs-' . $obsIndex++,
            'kind' => 'support_conversation_summary',
            'label' => 'Support conversation summary',
            'detail' => sprintf(
                '%s. Customer: %s. %d message%s in this thread.',
                $conversationSubject,
                $customerEmail,
                count($threads),
                count($threads) === 1 ? '' : 's',
            ),
            'confidence' => 1.0,
        ];

        foreach ($threads as $thread) {
            $observations[] = [
                'id' => 'obs-' . $obsIndex++,
                'kind' => 'support_message',
                'label' => sprintf('Message from %s', $thread['author']),
                'detail' => $thread['body'],
                'confidence' => 1.0,
                'data' => ['sent_at' => $thread['sentAt']],
            ];
        }

        $attachmentPayloads = [];
        $skipped = [];
        $attIndex = 1;
        foreach ($attachments as $attachment) {
            if (!in_array($attachment['mimeType'], self::SUPPORTED_MIME_TYPES, true)) {
                $skipped[] = $attachment['filename'] . ' (' . $attachment['mimeType'] . ')';
                continue;
            }
            $id = 'att-' . $attIndex++;
            $attachmentPayloads[] = [
                'id' => $id,
                'filename' => $attachment['filename'],
                'mime_type' => $attachment['mimeType'],
                'size' => strlen($attachment['bytes']),
                // SHA-256 over the raw binary bytes, before base64 encoding. Hashing the
                // base64 text instead is the single most common mistake the producer guide
                // warns about, so the two steps are kept visibly separate here.
                'content_hash' => hash('sha256', $attachment['bytes']),
                'encoding' => 'base64',
                'data' => base64_encode($attachment['bytes']),
            ];
        }

        if ($skipped !== []) {
            $observations[] = [
                'id' => 'obs-' . $obsIndex++,
                'kind' => 'unsupported_attachment',
                'label' => 'Attachments not included',
                'detail' => sprintf(
                    'This conversation had %d attachment%s Tracepack\'s v1 schema does not accept as evidence files (only PDF, JPEG, PNG and WebP are supported): %s. Add them to the pack manually if they matter.',
                    count($skipped),
                    count($skipped) === 1 ? '' : 's',
                    implode(', ', $skipped),
                ),
                'confidence' => 1.0,
            ];
        }

        $draft = [
            'schema_version' => 1,
            'source' => array_filter([
                'producer_id' => $producerId,
                'producer_name' => $producerName,
                'producer_version' => $producerVersion,
            ], static fn ($value) => $value !== null),
            'capture_timestamp' => $captureTimestamp,
            'source_url' => $sourceUrl,
            'evidence_type' => 'support_conversation',
            'attachments' => $attachmentPayloads,
            'observations' => $observations,
            'integrity' => [
                'algorithm' => 'sha256',
                'canonicalization' => 'RFC8785',
                'payload_hash' => str_repeat('0', 64),
            ],
        ];

        // Left out entirely rather than set to null when absent. The schema's `metadata` is
        // an optional object (Zod's .optional()), not a nullable one, so a literal `null` here
        // would fail validation instead of just being ignored.
        $metadata = [
            'subject' => $conversationSubject,
        ];

        if ($externalReference !== null) {
            $metadata['external_reference'] = $externalReference;
        }

        $draft['metadata'] = $metadata;

        $draft['integrity']['payload_hash'] = self::computePayloadHash($draft);

        return $draft;
    }

    /**
     * Mirrors PRODUCER_GUIDE.md section 3 exactly: strip `data` from every attachment, strip
     * `payload_hash` from `integrity`, canonicalize what remains, SHA-256 it.
     */
    private static function computePayloadHash(array $draft): string
    {
        $hashable = $draft;
        $hashable['attachments'] = array_map(static function (array $attachment) {
            unset($attachment['data']);
            return $attachment;
        }, $draft['attachments']);
        $hashable['integrity'] = [
            'algorithm' => $draft['integrity']['algorithm'],
            'canonicalization' => $draft['integrity']['canonicalization'],
        ];

        return hash('sha256', self::canonicalize($hashable));
    }

    /**
     * A minimal RFC 8785-compatible canonicalizer: object keys sorted, no insignificant
     * whitespace, UTF-8 preserved rather than escaped to \uXXXX. Adequate for the ASCII-ish,
     * shallow payloads this module builds; the same scoping caveat the JS embed example gives
     * for its own inline canonicalizer applies here: a real integration handling arbitrary
     * user text should reach for a dedicated RFC 8785 library instead of this one, the way
     * @tracepack/evidence-sdk itself does on the TypeScript side.
     */
    private static function isList(array $value): bool
    {
        if ($value === []) {
            return true;
        }

        return array_keys($value) === range(0, count($value) - 1);
    }

    public static function canonicalize($value): string
    {
        if (is_array($value) && self::isList($value)) {
            return '[' . implode(',', array_map([self::class, 'canonicalize'], $value)) . ']';
        }
        if (is_array($value)) {
            $keys = array_keys($value);
            sort($keys, SORT_STRING);
            $parts = [];
            foreach ($keys as $key) {
                $parts[] = json_encode((string) $key, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . ':' . self::canonicalize($value[$key]);
            }
            return '{' . implode(',', $parts) . '}';
        }
        if (is_bool($value) || $value === null) {
            return json_encode($value);
        }
        if (is_int($value)) {
            return (string) $value;
        }
        if (is_float($value)) {
            // RFC 8785 requires the shortest round-tripping decimal form; PHP's default float
            // string conversion is close enough for the fixed-precision confidence values (0.0
            // to 1.0) this module ever produces, but is not a general-purpose implementation.
            return json_encode($value);
        }
        return json_encode((string) $value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }
}
