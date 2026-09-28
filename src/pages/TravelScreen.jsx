import { useNavigate } from "react-router-dom";
import { Airplane, Bed } from "phosphor-react";
import { HOTELS, FLIGHTS } from "../data/travel";

export default function TravelScreen({ useAppState }) {
  const navigate = useNavigate();
  const { hotel, flight, dest } = useAppState;

  const hotelPicked = typeof hotel === "object" && hotel ? hotel : HOTELS.find((h) => h.id === hotel);
  const flightPicked = typeof flight === "object" && flight ? flight : FLIGHTS.find((f) => f.id === flight);
  const both = Boolean(hotelPicked && flightPicked);

  return (
    <section className="screen active screen-travel">
      <div className="travel-head">
        <h1 className="h-display" style={{ fontSize: 27 }}>Trip basics</h1>
        <div className="eyebrow" style={{ marginTop: 4 }}>
          {dest ? `Planning travel for ${dest}` : "As the leader, pick the stay & the flight."}
        </div>
      </div>

      <div className="travel-flow" style={{ marginTop: 16 }}>
        {/* Where you'll stay section */}
        <div>
          <div className="bento-card travel-section" style={{ padding: "var(--card-pad)" }}>
            <div className="travel-sec-head" style={{ marginTop: 0, marginBottom: 12 }}>
              <h2>Where you'll stay</h2>
              <span className="eyebrow">
                {hotelPicked ? (hotelPicked.type === "rental" ? "Vacation rental" : "Hotel picked") : "none picked"}
              </span>
            </div>

            {hotelPicked ? (
              <div className="travel-picked-card">
                <div
                  className="tl-thumb travel-picked-thumb"
                  style={{ backgroundImage: `url('${hotelPicked.img || "/images/alfama.jpg"}')` }}
                />
                <div className="tl-main">
                  <div className="travel-picked-title-row">
                    <span className="tl-name">{hotelPicked.name}</span>
                    <span className="travel-picked-badge">
                      {hotelPicked.type === "rental" ? "Rental" : "Hotel"}
                    </span>
                  </div>
                  <div className="tl-sub">
                    {hotelPicked.rate ? `★ ${hotelPicked.rate} · ` : ""}
                    {hotelPicked.area || hotelPicked.note || "Selected property"}
                  </div>
                  {hotelPicked.amenities && hotelPicked.amenities.length > 0 && (
                    <div className="travel-amenity-tags">
                      {hotelPicked.amenities.slice(0, 3).map((am, i) => (
                        <span key={i} className="travel-amenity-chip">{am}</span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="tl-tail">
                  <div className="tl-price">{hotelPicked.price}</div>
                  <button
                    className="btn btn-secondary btn-xs"
                    style={{ marginTop: 8 }}
                    onClick={() => navigate("/travel/search?tab=hotels")}
                  >
                    Change
                  </button>
                </div>
              </div>
            ) : (
              <div className="travel-empty-card">
                <div className="travel-empty-icon">
                  <Bed size={28} weight="duotone" />
                </div>
                <div className="travel-empty-text">
                  <h3>No stay selected yet</h3>
                  <p>Search hotels and vacation rentals with live rates</p>
                </div>
                <button
                  className="btn btn-primary"
                  onClick={() => navigate("/travel/search?tab=hotels")}
                >
                  Set stays →
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Getting there section */}
        <div>
          <div className="bento-card travel-section" style={{ padding: "var(--card-pad)" }}>
            <div className="travel-sec-head" style={{ marginTop: 0, marginBottom: 12 }}>
              <h2>Getting there</h2>
              <span className="eyebrow">{flightPicked ? "Flight picked" : "none picked"}</span>
            </div>

            {flightPicked ? (
              <div className="travel-picked-card">
                <div
                  className="tl-thumb travel-picked-thumb"
                  style={{
                    backgroundImage: `url('${flightPicked.img || flightPicked.logo || "/images/miradouro-santa-luzia.jpg"}')`,
                    backgroundSize: flightPicked.logo && !flightPicked.img ? "contain" : "cover",
                    backgroundRepeat: "no-repeat"
                  }}
                />
                <div className="tl-main">
                  <div className="travel-picked-title-row">
                    <span className="tl-name">{flightPicked.airline || flightPicked.name}</span>
                    {flightPicked.flightNumber && (
                      <span className="travel-picked-badge">{flightPicked.flightNumber}</span>
                    )}
                  </div>
                  <div className="tl-sub">
                    {flightPicked.dep && flightPicked.arr ? `${flightPicked.dep} → ${flightPicked.arr} · ` : ""}
                    {flightPicked.dur ? `${flightPicked.dur} · ` : ""}
                    {flightPicked.stops || "Nonstop"}
                  </div>
                  {flightPicked.dates && (
                    <div className="travel-amenity-tags">
                      <span className="travel-amenity-chip">{flightPicked.dates}</span>
                    </div>
                  )}
                </div>
                <div className="tl-tail">
                  <div className="tl-price">{flightPicked.price}</div>
                  <button
                    className="btn btn-secondary btn-xs"
                    style={{ marginTop: 8 }}
                    onClick={() => navigate("/travel/search?tab=flights")}
                  >
                    Change
                  </button>
                </div>
              </div>
            ) : (
              <div className="travel-empty-card">
                <div className="travel-empty-icon">
                  <Airplane size={28} weight="duotone" />
                </div>
                <div className="travel-empty-text">
                  <h3>No flights selected yet</h3>
                  <p>Search round-trip and one-way flights with real-time fares</p>
                </div>
                <button
                  className="btn btn-primary"
                  onClick={() => navigate("/travel/search?tab=flights")}
                >
                  Set flights →
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {both ? (
        <button
          className="btn btn-primary btn-block"
          style={{ marginTop: 24 }}
          onClick={() => navigate("/plan")}
        >
          Looks good — back to the plan →
        </button>
      ) : (
        <div className="travel-status-bar" style={{ marginTop: 20 }}>
          <span className="eyebrow">
            {!hotelPicked && !flightPicked
              ? "Select both a stay and a flight to proceed"
              : !hotelPicked
                ? "Almost ready: pick a stay to continue"
                : "Almost ready: pick a flight to continue"}
          </span>
        </div>
      )}
    </section>
  );
}
