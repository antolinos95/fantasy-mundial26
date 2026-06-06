-- schema_v13: Trigger para recalcular puntos automáticamente al finalizar partido

CREATE OR REPLACE FUNCTION trigger_recalculate_on_finish()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $func$
BEGIN
  IF NEW.status = 'finished' AND (OLD.status IS DISTINCT FROM 'finished') THEN
    PERFORM recalculate_scores(NEW.id);
  END IF;
  RETURN NEW;
END;
$func$;

DROP TRIGGER IF EXISTS trg_recalculate_on_finish ON matches;
CREATE TRIGGER trg_recalculate_on_finish
  AFTER UPDATE OF status ON matches
  FOR EACH ROW EXECUTE FUNCTION trigger_recalculate_on_finish();
