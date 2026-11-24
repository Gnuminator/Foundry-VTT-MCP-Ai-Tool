### Test kit

- **Obsidian mirror live check:** the new full-size kit scenario `obsidian-mirror-live` turns the mirror on for the kit world on server A, waits for one reconcile and checks that notes are written to the test vault (counts above zero, no errors, nothing skipped), that a hand-edited note is left alone and that a deleted actor's note moves to `.trash`. RELEASING gets a five-line plugin smoke list.
