### Campaign notes

- **Campaign merge plan:** after a notes run, `session_notes campaign` builds the plan that feeds the
  Campaign journals (campaign-merge, D-151): one Claude call on the subscription reads the
  worth-remembering layer, the transcript lines it cites and the Foundry chat log, and the code applies
  the ownership table. Pages for names nobody has confirmed wait and go to the "Names and facts to check"
  page; stats, items, level and ownership stay Foundry's (a difference goes to the check page); house rules
  are written as proposed until Danni confirms; every timeline line links to its transcript line. The plan
  only adds text. The automatic pass builds it once the notes are done.
- **Fix, campaign pages:** a timeline line containing a double quote was added again on every merge
  run, because Foundry stores the quote unescaped; the "already there" check now compares both sides
  the same way.
