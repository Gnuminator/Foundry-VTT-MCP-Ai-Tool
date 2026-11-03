<script lang="ts">
  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { Dialog } from 'bits-ui';

  import {
    PARTY_QUERY_KEY,
    memberFacts,
    type LoadParty,
    type PlanPace,
  } from '../shared/party';

  interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    load: LoadParty;
    planPace: PlanPace;
  }
  let { open, onOpenChange, load, planPace }: Props = $props();

  const client = useQueryClient();
  const party = createQuery(() => ({
    queryKey: PARTY_QUERY_KEY,
    queryFn: load,
    enabled: open,
    staleTime: 0,
    retry: false,
  }));
  const pace = createMutation(() => ({
    mutationFn: (v: { groupId: string; pace: string }) => planPace(v.groupId, v.pace),
    onSuccess: () => client.invalidateQueries({ queryKey: PARTY_QUERY_KEY }),
  }));

  let groupId = $state<string | null>(null);
  const groups = $derived(party.data?.groups ?? []);
  const group = $derived(groups.find(g => g.actorId === groupId) ?? groups[0]);
  const sub = $derived(
    party.isPending
      ? 'Loading...'
      : group
        ? `${group.name}, level ${group.level}, ${group.members.length} members`
        : ''
  );
  const hpClass = (r: number): string => (r <= 1 / 3 ? 'low' : r <= 2 / 3 ? 'mid' : '');
</script>

<Dialog.Root bind:open={() => open, onOpenChange}>
  <Dialog.Portal>
    <Dialog.Overlay class="spk-overlay" />
    <Dialog.Content class="spk-dialog">
      <div class="spk-head">
        <div>
          <Dialog.Title>
            {#snippet child({ props })}<h2 {...props}>Party</h2>{/snippet}
          </Dialog.Title>
          <Dialog.Description class="spk-sub">{sub}</Dialog.Description>
        </div>
        <Dialog.Close aria-label="Close party">✕</Dialog.Close>
      </div>
      <div class="spk-bar">
        <button disabled={party.isFetching} onclick={() => party.refetch()}>Refresh</button>
        {#if groups.length > 1 && group}
          <select aria-label="Party group" value={group.actorId} onchange={e => (groupId = e.currentTarget.value)}>
            {#each groups as g (g.actorId)}
              <option value={g.actorId}>{g.name}</option>
            {/each}
          </select>
        {/if}
      </div>
      {#if party.isPending}
        <p role="status">Loading the party...</p>
      {:else if party.isError}
        <p role="alert" class="spk-error">Couldn't load the party: {party.error.message}</p>
        <button onclick={() => party.refetch()}>Retry</button>
      {:else if !group}
        <p>No party yet. Create a Group actor in Foundry and set it as the primary party.</p>
      {:else}
        <ul class="spk-members" aria-label="Members">
          {#each group.members as m (m.actorId)}
            {@const chips = [...(m.exhaustion > 0 ? [`Exhaustion ${m.exhaustion}`] : []), ...m.conditions]}
            {@const ratio = m.hp && m.hp.max > 0 ? m.hp.value / m.hp.max : 0}
            <li class="spk-member">
              <div>
                <span class="spk-name">{m.name}</span>
                {#if m.inspiration}
                  <span class="spk-star" aria-hidden="true">★</span><span class="sr-only">Inspiration</span>
                {/if}
                <p class="spk-facts">{memberFacts(m)}</p>
                {#if chips.length > 0}
                  <div class="spk-chips">
                    {#each chips as c, i (i)}<span class="spk-chip">{c}</span>{/each}
                  </div>
                {/if}
              </div>
              {#if m.hp && m.hp.max > 0}
                <div class="spk-hp">
                  {m.hp.value}/{m.hp.max}{m.hp.temp > 0 ? ` +${m.hp.temp}` : ''}
                  <div class="spk-hp-bar">
                    <div class="spk-hp-fill {hpClass(ratio)}" style:width="{Math.max(0, Math.min(100, ratio * 100))}%"></div>
                  </div>
                </div>
              {/if}
            </li>
          {/each}
        </ul>
        <h3>Travel pace</h3>
        {#if group.pace}
          {@const now = group.pace}
          <p class="spk-facts">Now: <strong>{now.label}</strong></p>
          <div class="spk-bar">
            {#each party.data?.paceOptions ?? [] as o (o.value)}
              <button
                disabled={pace.isPending || o.value === now.value}
                onclick={() => pace.mutate({ groupId: group.actorId, pace: o.value })}>{o.label}</button>
            {/each}
          </div>
        {:else}
          <p class="spk-facts">This group has no travel pace.</p>
        {/if}
      {/if}
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
