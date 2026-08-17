<?php

namespace Modules\TracepackForFreescout\Http\Controllers;

use App\Attachment;
use App\Conversation;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Modules\TracepackForFreescout\Support\EvidencePayloadBuilder;

/**
 * Builds a tracepack-evidence v1 payload for one conversation and returns it as JSON, so the
 * button's own JS (Resources/views/button.blade.php) can hand it to the customer's Tracepack
 * tab via postMessage without ever building the payload itself, the producer guide's own
 * advice ("build it server-side if you can") is why this exists as a controller endpoint rather
 * than client-side JS reading the DOM.
 *
 * NOTE: Conversation/Thread/Attachment field and method names below (subject, customer email
 * access, thread body/author, attachment mime type and storage path) are written from
 * FreeScout's publicly documented model API. This has not been exercised against a running
 * FreeScout instance in this environment, there isn't one to test against here. Check the
 * exact property and method names against your installed FreeScout version before relying on
 * this in production; see this module's README for what to verify first.
 */
class SendToTracepackController extends Controller
{
    public function payload(Conversation $conversation): JsonResponse
    {
        $this->authorize('view', $conversation);

        $threads = $conversation->threads()
            ->orderBy('created_at', 'asc')
            ->get()
            ->filter(fn ($thread) => trim($thread->getCleanBody() ?? '') !== '')
            ->map(fn ($thread) => [
                'author' => $thread->created_by_customer
                    ? ($conversation->customer->getFullName() ?: $conversation->customer->email)
                    : (optional($thread->created_by_user)->getFullName() ?: 'Agent'),
                'body' => trim($thread->getCleanBody()),
                'sentAt' => $thread->created_at->toIso8601String(),
            ])
            ->values()
            ->all();

        $attachmentLimit = (int) config('tracepackforfreescout.max_attachment_bytes', 10485760);
        $totalLimit = (int) config('tracepackforfreescout.max_payload_bytes', 26214400);
        $runningTotal = array_sum(array_map(fn ($thread) => strlen($thread['body']), $threads));
        if ($runningTotal > $totalLimit) {
            abort(422, 'This conversation is larger than the 25 MB staging limit. Send a shorter conversation and try again.');
        }

        $attachments = Attachment::whereIn('thread_id', $conversation->threads()->pluck('id'))
            ->get()
            ->map(function (Attachment $attachment) use ($attachmentLimit, $totalLimit, &$runningTotal) {
                if (!in_array($attachment->mime_type, EvidencePayloadBuilder::SUPPORTED_MIME_TYPES, true)) {
                    return [
                        'id' => (string) $attachment->id,
                        'mimeType' => $attachment->mime_type,
                        'filename' => $attachment->file_name,
                        'bytes' => '',
                    ];
                }
                if ((int) $attachment->size > $attachmentLimit) {
                    abort(422, 'An attachment is larger than the 10 MB staging limit. Remove it or add it to Tracepack manually.');
                }
                $bytes = $attachment->getFileContents();
                $runningTotal += strlen($bytes ?? '');
                if ($runningTotal > $totalLimit) {
                    abort(422, 'The supported attachments are larger than the 25 MB staging limit. Send fewer attachments and try again.');
                }
                return [
                    'id' => (string) $attachment->id,
                    'mimeType' => $attachment->mime_type,
                    'filename' => $attachment->file_name,
                    'bytes' => $bytes,
                ];
            })
            ->filter(fn ($attachment) => !in_array($attachment['mimeType'], EvidencePayloadBuilder::SUPPORTED_MIME_TYPES, true) || ($attachment['bytes'] !== null && $attachment['bytes'] !== ''))
            ->values()
            ->all();

        $payload = EvidencePayloadBuilder::build(
            producerId: config('tracepackforfreescout.producer_id', 'org.freescout.tracepack-for-freescout'),
            producerName: config('tracepackforfreescout.producer_name', config('app.name', 'FreeScout') . ' (FreeScout helpdesk)'),
            producerVersion: null,
            sourceUrl: $conversation->url(),
            conversationSubject: (string) $conversation->subject,
            customerEmail: (string) $conversation->customer->email,
            threads: $threads,
            attachments: $attachments,
            captureTimestamp: now()->toIso8601String(),
            externalReference: 'Conversation #' . $conversation->id,
        );

        return response()->json($payload);
    }
}
