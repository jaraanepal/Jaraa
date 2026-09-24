import { useLang } from "../i18n/LanguageContext";
import { NoticeBox } from "../components/ui";
import { Icon } from "../components/icons";
import enDict from "../i18n/en.json";
import neDict from "../i18n/ne.json";

interface Card { title: string; body: string }

/**
 * Habit coach: non-medical nudges and education only — never diagnosis,
 * never medical advice. Content comes from the bilingual dictionaries.
 */
export default function Coach() {
  const { t, lang } = useLang();
  const dict = lang === "ne" ? neDict : enDict;
  const cards = (dict as unknown as { coach: { cards: Card[]; nudges: string[] } }).coach.cards;
  const nudges = (dict as unknown as { coach: { cards: Card[]; nudges: string[] } }).coach.nudges;

  return (
    <div className="screen">
      <h1>{t("coach.title")}</h1>
      <p className="muted">{t("coach.sub")}</p>

      <NoticeBox tone="notice" title="">
        <p className="tiny">{t("coach.disclaimer")}</p>
      </NoticeBox>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>{t("coach.nudgesTitle")}</h3>
        {nudges.map((n, i) => (
          <p key={i} className="tiny" style={{ margin: "8px 0" }}>
            <span style={{ color: "var(--green)", verticalAlign: "-3px", marginRight: 6 }}>
              <Icon.leaf size={14} />
            </span>
            {n}
          </p>
        ))}
      </div>

      <h3>{t("coach.educationTitle")}</h3>
      {cards.map((c, i) => (
        <div className="card" key={i}>
          <b>{c.title}</b>
          <p className="muted tiny">{c.body}</p>
        </div>
      ))}
    </div>
  );
}
