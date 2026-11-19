CREATE OR REPLACE FUNCTION submit_attempt(p_attempt_id BIGINT, p_response JSONB, p_help_used JSONB DEFAULT '[]'::jsonb)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_att task_attempts%ROWTYPE;
  v_presented JSONB;
  v_response JSONB;
  v_pos INT := 0;
  v_item INT := 0;
  v_i INT;
  v_total INT;
  v_resp_ids TEXT[];
  v_full BOOLEAN;
BEGIN
  SELECT * INTO v_att FROM task_attempts WHERE id = p_attempt_id FOR UPDATE;
  IF v_att.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF v_att.status <> 'in_progress' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_submitted', 'status', v_att.status);
  END IF;

  v_presented := v_att.presented_items;
  v_response := COALESCE(p_response, '[]'::jsonb);
  v_total := jsonb_array_length(v_presented);

  SELECT COALESCE(array_agg(x->>'id'), ARRAY[]::TEXT[]) INTO v_resp_ids
  FROM jsonb_array_elements(v_response) x;

  FOR v_i IN 0 .. v_total - 1 LOOP
    IF v_response->v_i IS NOT NULL
       AND (v_response->v_i->>'id') = (v_presented->v_i->>'id') THEN
      v_pos := v_pos + 1;
    END IF;
    IF (v_presented->v_i->>'id') = ANY(v_resp_ids) THEN
      v_item := v_item + 1;
    END IF;
  END LOOP;

  v_full := (v_pos = v_total AND v_total > 0);

  UPDATE task_attempts
  SET status = 'submitted', response_items = v_response, help_used = COALESCE(p_help_used, '[]'::jsonb),
      positional_correct = v_pos, item_correct = v_item, full_correct = v_full,
      submitted_at = now()
  WHERE id = p_attempt_id;

  RETURN jsonb_build_object('ok', true, 'positional_correct', v_pos, 'item_correct', v_item,
    'full_correct', v_full, 'total_items', v_total);
END;
$$;
