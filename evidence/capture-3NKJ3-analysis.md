## Message mix

| type                       | sent | received | bytes  |
|----------------------------|------|----------|--------|
| authoritative_patch_commit | 0    | 369      | 533525 |
| authoritative_snapshot     | 0    | 6        | 237820 |
| presence_update            | 931  | 0        | 115120 |
| room_shell_sync            | 0    | 10       | 86340  |
| presence_event             | 0    | 429      | 75367  |
| action_intent              | 165  | 0        | 52762  |
| rewind_confirmation_state  | 0    | 253      | 20493  |
| auth_refresh               | 11   | 0        | 12342  |
| auth_session               | 0    | 14       | 1803   |
| join_shell                 | 1    | 0        | 1117   |
| join_game                  | 1    | 0        | 1116   |
| resume_game                | 1    | 0        | 1099   |
| chat_sync                  | 0    | 3        | 644    |
| chat_append                | 0    | 2        | 401    |
| judge_call_sync            | 0    | 3        | 324    |
| gameplay_action_noop_ack   | 0    | 2        | 260    |
| error                      | 0    | 1        | 237    |
| spectator_roster_sync      | 0    | 3        | 219    |
| chat_send                  | 1    | 0        | 131    |
| setup_log_sync             | 0    | 1        | 59     |

## Patch operation verbs

| op                | count |
|-------------------|-------|
| zone_reorder      | 301   |
| log_insert        | 290   |
| patch_card_fields | 226   |
| log_remove        | 189   |
| zone_insert       | 132   |
| set_room_fields   | 129   |
| zone_remove       | 107   |
| zone_move         | 69    |
| unset_room_fields | 29    |
| set_board_fields  | 19    |
| chain_insert      | 15    |
| chain_remove      | 15    |
| set_player_fields | 4     |
| unset_card_fields | 3     |
| chain_replace     | 1     |

## Committed action types

| action                            | count |
|-----------------------------------|-------|
| rune_batch                        | 59    |
| adjust_card_counter               | 55    |
| move_card                         | 53    |
| battlefield_conquer_pass_focus    | 21    |
| move_cards_to_trash_batch         | 21    |
| draw_cards                        | 21    |
| chain_resolve                     | 15    |
| battlefield_conquer_pass_response | 13    |
| battlefield_conquer_confirm       | 13    |
| end_turn                          | 12    |
| chain_set_resolve_vote            | 11    |
| payment_batch                     | 10    |
| chain_add                         | 10    |
| toggle_exhausted                  | 9     |
| target_arrow_add                  | 9     |
| create_token                      | 8     |
| set_card_hidden                   | 6     |
| set_card_label                    | 5     |
| equip_card                        | 4     |
| select_battlefield                | 2     |
| submit_sideboard                  | 2     |
| submit_mulligan                   | 2     |
| set_hand_reveal                   | 2     |
| roll_initiative                   | 1     |
| choose_first_player               | 1     |
| request_sideboard_skip            | 1     |
| respond_sideboard_skip            | 1     |
| adjust_card_might                 | 1     |
| rewind_last_action                | 1     |

## Replay budget

| metric              | value              |
|---------------------|--------------------|
| frames              | 2207               |
| wall clock          | 19.4 min           |
| sequences           | 371 (0..370)       |
| snapshots           | 4                  |
| commits             | 369                |
| resyncs             | 1                  |
| total wire bytes    | 1141179 (1114 KiB) |
| state-bearing bytes | 915794 (894 KiB)   |
| ephemeral bytes     | 225385 (20%)       |
