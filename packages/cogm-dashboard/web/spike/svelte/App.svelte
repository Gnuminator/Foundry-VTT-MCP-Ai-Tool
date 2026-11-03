<script lang="ts">
  import { QueryClient, QueryClientProvider } from '@tanstack/svelte-query';

  import { httpLoad, httpPlanPace } from '../shared/party';

  const client = new QueryClient();
  let open = $state(false);
  let wanted = $state(false);
</script>

<QueryClientProvider {client}>
  <button class="spk-open" onclick={() => ((wanted = true), (open = true))}>Party</button>
  {#if wanted}
    {#await import('./Party.svelte') then { default: Party }}
      <Party {open} onOpenChange={v => (open = v)} load={httpLoad} planPace={httpPlanPace} />
    {/await}
  {/if}
</QueryClientProvider>
