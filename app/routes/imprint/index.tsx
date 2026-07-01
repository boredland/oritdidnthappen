import { createRoute } from "honox/factory";
import { H2, Prose } from "../-components/Prose";

// German legal imprint (Impressum) per TMG §5 + §18 Abs. 2 MStV.
const OPERATOR = {
  name: "Jonas Strassel",
  city: "Frankfurt am Main, Germany",
  email: "feedback@oritdidnthappen.pics",
};

export default createRoute((c) => {
  return c.render(
    <Prose title="Imprint" updated="June 2026">
      <p>Angaben gemäß § 5 TMG.</p>

      <div>
        <H2>Anbieter (TMG §5)</H2>
        <p class="mt-3">
          {OPERATOR.name}
          <br />
          {OPERATOR.city}
        </p>
      </div>

      <div>
        <H2>Kontakt</H2>
        <p class="mt-3">
          <a
            href={`mailto:${OPERATOR.email}`}
            class="underline underline-offset-2 hover:text-charcoal"
          >
            {OPERATOR.email}
          </a>
        </p>
      </div>

      <div>
        <H2>Inhaltlich Verantwortlicher gemäß §18 Abs. 2 MStV</H2>
        <p class="mt-3">
          {OPERATOR.name}, {OPERATOR.city}
        </p>
      </div>

      <div>
        <H2>Haftungsausschluss</H2>
        <p class="mt-3">
          Trotz sorgfältiger inhaltlicher Kontrolle übernehmen wir keine Haftung
          für die Inhalte externer Links. Für den Inhalt der verlinkten Seiten
          sind ausschließlich deren Betreiber verantwortlich. Fotos werden
          ausschließlich im eigenen Cloud-Speicher der Veranstalter abgelegt,
          nicht auf unseren Servern.
        </p>
      </div>

      <div>
        <H2>Quellcode</H2>
        <p class="mt-3">
          <a
            href="https://github.com/boredland/oritdidnthappen"
            target="_blank"
            rel="noopener noreferrer"
            class="underline underline-offset-2 hover:text-charcoal"
          >
            github.com/boredland/oritdidnthappen
          </a>
        </p>
      </div>
    </Prose>,
    {
      title: "Imprint",
      description: "Imprint / Impressum for or it didn't happen.",
    },
  );
});
