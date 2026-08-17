{{--
    FreeScout builds the evidence payload server-side. The browser adapter then
    hands that payload to @tracepack/integration, which owns the versioned
    TracePack handoff protocol and browser messaging lifecycle.
--}}
<li>
    <a
        href="#"
        id="send-to-tracepack-btn"
        data-payload-url="{{ route('tracepackforfreescout.payload', $conversation->id) }}"
        data-tracepack-url="{{ config('tracepackforfreescout.app_url', 'https://app.tracepack.org') }}"
        data-reference="Conversation #{{ $conversation->id }}"
    >
        <i class="glyphicon glyphicon-export"></i>
        Send to Tracepack
    </a>
</li>

<li class="disabled">
    <a
        href="#"
        id="send-to-tracepack-status"
        style="font-size: 12px; color: #767676; display: none; white-space: normal; overflow-wrap: anywhere; line-height: 1.4;"
    ></a>
</li>

@section('javascripts')
    @parent
    {!! Minify::javascript([
        '/modules/tracepackforfreescout/js/tracepack-integration.js',
        '/modules/tracepackforfreescout/js/tracepack-button.js'
    ]) !!}
@endsection
