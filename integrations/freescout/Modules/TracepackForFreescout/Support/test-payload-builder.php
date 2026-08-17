<?php

// Standalone check for EvidencePayloadBuilder: builds a payload from a fake conversation (one
// PDF attachment, one unsupported .docx that should be described instead of dropped, two thread
// messages) and writes it to disk. Cross-checked against the real @tracepack/evidence-sdk
// validator by a companion Node script, not just eyeballed here. See verify.mjs next to this
// file. Not a FreeScout integration test (no FreeScout instance in this environment); this only
// proves the payload the module would send is schema-valid and correctly hashed.

require __DIR__ . '/EvidencePayloadBuilder.php';

use Modules\TracepackForFreescout\Support\EvidencePayloadBuilder;

$pdfBytes = "%PDF-1.4\n%fake pdf bytes for a test fixture\n%%EOF";
$docxBytes = 'not a real docx, just bytes standing in for one';

$payload = EvidencePayloadBuilder::build(
    producerId: 'org.freescout.send-to-tracepack',
    producerName: 'Example Helpdesk (FreeScout)',
    producerVersion: '0.1.0',
    sourceUrl: 'https://helpdesk.example.com/conversation/482',
    conversationSubject: 'Order #4821 arrived damaged',
    customerEmail: 'customer@example.com',
    threads: [
        ['author' => 'customer@example.com', 'body' => 'The mug arrived cracked in transit, I would like a refund.', 'sentAt' => '2026-08-01T09:12:00Z'],
        ['author' => 'Agent Jordan', 'body' => 'Sorry to hear that. I have attached the delivery photo the courier logged and requested a refund on our end.', 'sentAt' => '2026-08-01T10:03:00Z'],
    ],
    attachments: [
        ['id' => 'a1', 'mimeType' => 'application/pdf', 'filename' => 'delivery-report.pdf', 'bytes' => $pdfBytes],
        ['id' => 'a2', 'mimeType' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'filename' => 'internal-note.docx', 'bytes' => $docxBytes],
    ],
    captureTimestamp: '2026-08-01T10:05:00Z',
    externalReference: 'Conversation #1842',
);

if (($payload['metadata']['subject'] ?? null) !== 'Order #4821 arrived damaged') {
    fwrite(STDERR, "FAIL: expected metadata.subject to preserve the conversation subject\n");
    exit(1);
}

if (($payload['metadata']['external_reference'] ?? null) !== 'Conversation #1842') {
    fwrite(STDERR, "FAIL: expected metadata.external_reference to be set to the conversation reference\n");
    exit(1);
}

$expectedHash = hash('sha256', $pdfBytes);
$actualHash = $payload['attachments'][0]['content_hash'];
if ($expectedHash !== $actualHash) {
    fwrite(STDERR, "FAIL: content_hash mismatch. expected $expectedHash got $actualHash\n");
    exit(1);
}

if (count($payload['attachments']) !== 1) {
    fwrite(STDERR, 'FAIL: expected exactly 1 attachment (the unsupported .docx should be excluded), got ' . count($payload['attachments']) . "\n");
    exit(1);
}

$skippedNote = array_filter($payload['observations'], static fn ($obs) => $obs['kind'] === 'unsupported_attachment');
if (count($skippedNote) !== 1) {
    fwrite(STDERR, "FAIL: expected exactly one unsupported_attachment observation describing the skipped .docx\n");
    exit(1);
}

$outPath = __DIR__ . '/../../../tests/fixture-payload.json';
file_put_contents($outPath, json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . "\n");

echo "PHP-side checks passed. Payload written to $outPath\n";
echo "content_hash: $actualHash\n";
echo "payload_hash: {$payload['integrity']['payload_hash']}\n";
