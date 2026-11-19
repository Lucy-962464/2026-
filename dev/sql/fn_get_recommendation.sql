CREATE OR REPLACE FUNCTION get_recommendation(p_participant_id BIGINT, p_avoid_template_id BIGINT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  v_cnt INT;
  v_acc NUMERIC;
  v_difficulty TEXT;
  v_template RECORD;
  v_last_template BIGINT;
BEGIN
  SELECT COUNT(*), COALESCE(SUM(positional_correct), 0)::NUMERIC / GREATEST(SUM(total_items), 1)
    INTO v_cnt, v_acc
  FROM task_attempts
  WHERE participant_id = p_participant_id AND is_practice = false AND status = 'submitted';

  SELECT template_id INTO v_last_template
  FROM task_attempts
  WHERE participant_id = p_participant_id AND is_practice = false AND status = 'submitted'
  ORDER BY submitted_at DESC LIMIT 1;

  IF v_cnt = 0 THEN
    v_difficulty := 'easy';
  ELSIF v_acc >= 0.8 THEN
    v_difficulty := 'hard';
  ELSIF v_acc >= 0.6 THEN
    v_difficulty := 'medium';
  ELSE
    v_difficulty := 'easy';
  END IF;

  SELECT * INTO v_template
  FROM task_templates t
  WHERE t.status = 'published' AND t.difficulty = v_difficulty
    AND (p_avoid_template_id IS NULL OR t.id <> p_avoid_template_id)
  ORDER BY (t.id = COALESCE(v_last_template, -1)) ASC, random() ASC
  LIMIT 1;

  IF v_template.id IS NULL THEN
    SELECT * INTO v_template FROM task_templates t
    WHERE t.status = 'published' AND (p_avoid_template_id IS NULL OR t.id <> p_avoid_template_id)
    ORDER BY (t.id = COALESCE(v_last_template, -1)) ASC, random() ASC
    LIMIT 1;
  END IF;

  IF v_template.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_published_template');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'template', to_jsonb(v_template),
    'history_count', v_cnt,
    'accuracy', CASE WHEN v_cnt = 0 THEN NULL ELSE ROUND(v_acc, 3) END,
    'difficulty', v_difficulty
  );
END;
$$;
