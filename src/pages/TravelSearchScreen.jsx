import { useState, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import {
  Airplane,
  Bed,
  House,
  MagnifyingGlass,
  ArrowsLeftRight,
  CaretLeft,
  CaretRight,
  SlidersHorizontal,
  BookmarkSimple,
  Star,
  X,
  Sparkle,
  Users,
  CalendarBlank,
} from "phosphor-react";
import {
  searchFlights,
  searchHotels,
  searchVacationRentals,
} from "../services/travelSearch";

function getUpcomingDate(daysFromNow) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().split("T")[0];
}

function normalizeDate(val, fallbackDays) {
  if (!val) return getUpcomingDate(fallbackDays);
  try {
    const d = new Date(val);
    if (isNaN(d.getTime())) return getUpcomingDate(fallbackDays);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (d < today) return getUpcomingDate(fallbackDays);
    return d.toISOString().split("T")[0];
  } catch {
    return getUpcomingDate(fallbackDays);
  }
}

function formatDisplayDate(dateStr, fallback = "Select date") {
  if (!dateStr) return fallback;
  try {
    const parts = String(dateStr).split("-");
    if (parts.length === 3) {
      const year = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1;
      const day = parseInt(parts[2], 10);
      const d = new Date(year, month, day);
      return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    }
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) {
      return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    }
  } catch { }
  return dateStr || fallback;
}

export default function TravelSearchScreen({ useAppState }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { dest, startDate, endDate, selectFlight, selectHotel } = useAppState;

  const initialTab = searchParams.get("tab") || "flights";
  const [activeTab, setActiveTab] = useState(
    initialTab === "hotels" || initialTab === "rentals" ? initialTab : "flights"
  );

  // Sync tab with URL
  useEffect(() => {
    const tab = searchParams.get("tab");
    if (tab && (tab === "flights" || tab === "hotels" || tab === "rentals")) {
      setActiveTab(tab);
    }
  }, [searchParams]);

  const setTab = (tab) => {
    setActiveTab(tab);
    setSearchParams({ tab });
  };

  // Currency
  const [currency, setCurrency] = useState("USD");

  // Flight search form state
  const [tripType, setTripType] = useState("round");
  const [passengers, setPassengers] = useState(1);
  const [cabinClass, setCabinClass] = useState("Economy");
  const [origin, setOrigin] = useState("Penang");
  const [flightDest, setFlightDest] = useState(dest || "Singapore");
  const [depDate, setDepDate] = useState(() => normalizeDate(startDate, 14));
  const [retDate, setRetDate] = useState(() => normalizeDate(endDate, 21));
  const [flightStopsFilter, setFlightStopsFilter] = useState("all");

  // Hotel & Rentals search form state
  const [stayLocation, setStayLocation] = useState(dest || "Gelugor, Penang");
  const [checkIn, setCheckIn] = useState(() => normalizeDate(startDate, 7));
  const [checkOut, setCheckOut] = useState(() => normalizeDate(endDate, 10));
  const [guests, setGuests] = useState(2);

  // Hotel filters
  const [activeHotelFilter, setActiveHotelFilter] = useState("all");
  const [trackPrices, setTrackPrices] = useState(false);
  const [savedProperties, setSavedProperties] = useState({});

  // Rentals filters
  const [rentalTypeFilter, setRentalTypeFilter] = useState("all");

  // Data & loading states
  const [flights, setFlights] = useState([]);
  const [hotels, setHotels] = useState([]);
  const [rentals, setRentals] = useState([]);
  const [loading, setLoading] = useState(false);

  // Fetch flights
  const doSearchFlights = async () => {
    setLoading(true);
    try {
      const data = await searchFlights({
        origin,
        destination: flightDest,
        departureDate: depDate,
        returnDate: retDate,
        adults: passengers,
        currency,
        stopsFilter: flightStopsFilter,
      });
      setFlights(data);
    } catch {
      setFlights([]);
    } finally {
      setLoading(false);
    }
  };

  // Fetch hotels
  const doSearchHotels = async () => {
    setLoading(true);
    try {
      const data = await searchHotels({
        query: stayLocation,
        checkInDate: checkIn,
        checkOutDate: checkOut,
        adults: guests,
        currency,
        minRating: activeHotelFilter === "4plus" ? 4 : 0,
        amenityFilter:
          activeHotelFilter === "pool"
            ? "pool"
            : activeHotelFilter === "wifi"
              ? "wi-fi"
              : activeHotelFilter === "fitness"
                ? "fitness"
                : null,
      });
      setHotels(data);
    } catch {
      setHotels([]);
    } finally {
      setLoading(false);
    }
  };

  // Fetch vacation rentals
  const doSearchRentals = async () => {
    setLoading(true);
    try {
      const data = await searchVacationRentals({
        query: stayLocation,
        checkInDate: checkIn,
        checkOutDate: checkOut,
        adults: guests,
        currency,
        propertyTypeFilter: rentalTypeFilter,
      });
      setRentals(data);
    } catch {
      setRentals([]);
    } finally {
      setLoading(false);
    }
  };

  // Initial fetch and currency refetch
  useEffect(() => {
    if (activeTab === "flights") {
      doSearchFlights();
    } else if (activeTab === "hotels") {
      doSearchHotels();
    } else if (activeTab === "rentals") {
      doSearchRentals();
    }
  }, [activeTab, currency, flightStopsFilter, activeHotelFilter, rentalTypeFilter]);

  // Handlers for picking
  const handleSelectFlight = (flight) => {
    selectFlight(flight);
    navigate("/travel");
  };

  const handleSelectHotel = (hotel) => {
    selectHotel(hotel);
    navigate("/travel");
  };

  const handleGoogleHotelSearch = (name) => {
    window.open(
      `https://www.google.com/search?q=${encodeURIComponent(name)}`,
      "_blank"
    );
  };

  const handleSelectRental = (rental) => {
    selectHotel(rental);
    navigate("/travel");
  };

  // Swap flight origin and destination
  const handleSwapAirports = () => {
    setOrigin(flightDest);
    setFlightDest(origin);
  };

  // Adjust date step
  const stepDate = (setter, currentDate, days) => {
    try {
      const d = new Date(currentDate);
      d.setDate(d.getDate() + days);
      setter(d.toISOString().split("T")[0]);
    } catch { }
  };

  const toggleBookmark = (id) => {
    setSavedProperties((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <section className="screen active screen-travel-search">
      {/* Top Google Travel Navigation Bar */}
      <div className="travel-search-header-bar">
        <div className="travel-top-tabs">
          <button
            className={`travel-tab-btn ${activeTab === "flights" ? "active" : ""}`}
            onClick={() => setTab("flights")}
          >
            <Airplane size={18} weight={activeTab === "flights" ? "fill" : "regular"} />
            <span>Flights</span>
          </button>
          <button
            className={`travel-tab-btn ${activeTab === "hotels" ? "active" : ""}`}
            onClick={() => setTab("hotels")}
          >
            <Bed size={18} weight={activeTab === "hotels" ? "fill" : "regular"} />
            <span>Hotels</span>
          </button>
          <button
            className={`travel-tab-btn ${activeTab === "rentals" ? "active" : ""}`}
            onClick={() => setTab("rentals")}
          >
            <House size={18} weight={activeTab === "rentals" ? "fill" : "regular"} />
            <span>Vacation rentals</span>
          </button>
        </div>

        <div className="travel-currency-wrap">
          <label htmlFor="currency-select" className="sr-only">Currency</label>
          <select
            id="currency-select"
            className="travel-currency-select"
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
          >
            <option value="USD">USD ($)</option>
            <option value="EUR">EUR (€)</option>
            <option value="MYR">MYR (RM)</option>
            <option value="GBP">GBP (£)</option>
          </select>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* TAB 1: FLIGHTS (Matches Image 0) */}
      {/* ========================================================================= */}
      {activeTab === "flights" && (
        <div className="travel-tab-content">

          {/* Search Controls Form */}
          <div className="bento-card flight-search-container">
            {/* Control dropdowns */}
            <div className="flight-controls-row">
              <div className="flight-dropdown-pill">
                <select value={tripType} onChange={(e) => setTripType(e.target.value)}>
                  <option value="round">Round trip</option>
                  <option value="oneway">One way</option>
                </select>
              </div>

              <div className="flight-dropdown-pill">
                <Users size={14} />

                <div className="passenger-count-wrap">
                  <span className="stepper-value">{passengers}</span>

                  <div className="vertical-stepper">
                    <button
                      type="button"
                      className="stepper-btn"
                      onClick={() => setPassengers(Math.min(20, passengers + 1))}
                    >
                      ▲
                    </button>

                    <button
                      type="button"
                      className="stepper-btn"
                      onClick={() => setPassengers(Math.max(1, passengers - 1))}
                    >
                      ▼
                    </button>
                  </div>
                </div>

                <span className="flight-passengers-label">
                  {passengers === 1 ? "passenger" : "passengers"}
                </span>
              </div>

              <div className="flight-dropdown-pill">
                <select value={cabinClass} onChange={(e) => setCabinClass(e.target.value)}>
                  <option value="Economy">Economy</option>
                  <option value="Premium">Premium Economy</option>
                  <option value="Business">Business</option>
                  <option value="First">First</option>
                </select>
              </div>
            </div>

            {/* Inputs block: Origin, Dest, Dates */}
            <div className="flight-inputs-grid">
              <div className="flight-route-inputs">
                <div className="flight-input-field">
                  <span className="flight-input-dot" />
                  <input
                    type="text"
                    value={origin}
                    onChange={(e) => setOrigin(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") doSearchFlights();
                    }}
                    placeholder="Where from?"
                  />
                </div>

                <button
                  type="button"
                  className="flight-swap-btn"
                  onClick={handleSwapAirports}
                  title="Swap departure and arrival"
                >
                  <ArrowsLeftRight size={16} />
                </button>

                <div className="flight-input-field">
                  <span className="flight-input-pin">📍</span>
                  <input
                    type="text"
                    value={flightDest}
                    onChange={(e) => setFlightDest(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") doSearchFlights();
                    }}
                    placeholder="Where to?"
                  />
                </div>
              </div>

              <div className="flight-dates-inputs">
                <div className="flight-date-field" style={{ position: "relative" }}>
                  <CalendarBlank size={16} className="google-date-icon" />
                  <span className="google-date-value">
                    {formatDisplayDate(depDate, "Departure")}
                  </span>
                  <input
                    type="date"
                    className="google-hidden-date-input"
                    value={depDate}
                    onChange={(e) => setDepDate(e.target.value)}
                    aria-label="Departure date"
                  />
                </div>
                {tripType === "round" && (
                  <div className="flight-date-field" style={{ position: "relative" }}>
                    <CalendarBlank size={16} className="google-date-icon" />
                    <span className="google-date-value">
                      {formatDisplayDate(retDate, "Return")}
                    </span>
                    <input
                      type="date"
                      className="google-hidden-date-input"
                      value={retDate}
                      onChange={(e) => setRetDate(e.target.value)}
                      aria-label="Return date"
                    />
                  </div>
                )}
              </div>
            </div>

            <div className="flight-submit-row">
              <button
                className="btn btn-primary flight-explore-btn"
                onClick={doSearchFlights}
                disabled={loading}
              >
                <MagnifyingGlass size={18} />
                <span>{loading ? "Searching..." : "Explore"}</span>
              </button>
            </div>
          </div>

          {/* AI Deals Banner (From Image 0) */}
          <div className="flight-ai-deals-banner">
            <div className="flight-ai-deals-icon">
              <Sparkle size={20} weight="fill" />
            </div>
            <div className="flight-ai-deals-text">
              <strong>Flexible? Discover the best flight deals with AI</strong>
              <p>Describe your ideal trip, and let Google Flights find the best deals for you</p>
            </div>
            <button
              className="btn btn-secondary btn-xs flight-ai-deals-cta"
              onClick={() => {
                setOrigin("Penang");
                setFlightDest("Singapore");
                doSearchFlights();
              }}
            >
              Explore deals with AI
            </button>
          </div>

          {/* Quick Destination Chips */}
          <div className="flight-quick-section">
            <div className="flight-quick-title">
              <h3>Find cheap flights from {origin} to anywhere</h3>
            </div>
            <div className="flight-quick-chips">
              {["Penang", "Federal Territory of Kuala Lumpur", "Kota Kinabalu", "Kuching", "Labuan", "Terengganu", "Perak", "Pahang", "Malacca", "Kelantan", "Kedah", "Johor"].map(
                (city) => (
                  <button
                    key={city}
                    className={`chip ${flightDest.toLowerCase().includes(city.toLowerCase()) ? "sel" : ""}`}
                    onClick={() => {
                      setFlightDest(city);
                      setTimeout(doSearchFlights, 50);
                    }}
                  >
                    {city}
                  </button>
                )
              )}
            </div>
          </div>

          {/* Filter Pills */}
          <div className="flight-filter-chips-row">
            <button
              className={`chip ${flightStopsFilter === "all" ? "sel" : ""}`}
              onClick={() => setFlightStopsFilter("all")}
            >
              All flights
            </button>
            <button
              className={`chip ${flightStopsFilter === "nonstop" ? "sel" : ""}`}
              onClick={() => setFlightStopsFilter("nonstop")}
            >
              Nonstop only
            </button>
          </div>

          {/* Flight Result Cards */}
          <div className="flight-results-list">
            {flights.map((flight) => (
              <div key={flight.id} className="bento-card flight-card">
                <div className="flight-card-head">
                  <div className="flight-card-route">
                    <strong>{flight.origin || flight.depAirport} → {flight.destination || flight.arrAirport}</strong>
                    <span className="flight-card-meta">
                      {flight.dates || `${flight.dep} — ${flight.arr}`} · {flight.stops || "Nonstop"}
                    </span>
                  </div>
                  <div className="flight-card-pricing">
                    <span className="flight-card-price">{flight.price}</span>
                  </div>
                </div>

                <div className="flight-card-body">
                  <div className="flight-airline-badge">
                    {flight.logo ? (
                      <img src={flight.logo} alt={flight.airline} className="flight-airline-img" />
                    ) : (
                      <Airplane size={20} />
                    )}
                    <span>{flight.airline}</span>
                    {flight.flightNumber && <span className="eyebrow">{flight.flightNumber}</span>}
                  </div>

                  <div className="flight-times-row">
                    <div>
                      <div className="flight-time-val">{flight.dep}</div>
                      <div className="flight-airport-code">{flight.depAirport}</div>
                    </div>
                    <div className="flight-duration-line">
                      <span>{flight.dur}</span>
                      <div className="flight-line" />
                      <span className="flight-stops-label">{flight.stops}</span>
                    </div>
                    <div>
                      <div className="flight-time-val">{flight.arr}</div>
                      <div className="flight-airport-code">{flight.arrAirport}</div>
                    </div>
                  </div>
                </div>

                <div className="flight-card-footer">
                  {flight.carbonEmission && (
                    <span className="flight-carbon-tag">🌱 {flight.carbonEmission}</span>
                  )}
                  <button
                    className="btn btn-primary btn-xs"
                    onClick={() => handleSelectFlight(flight)}
                  >
                    Select flight
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: HOTELS (Matches Image 1) */}
      {/* ========================================================================= */}
      {activeTab === "hotels" && (
        <div className="travel-tab-content">
          {/* Hotels Search Bar */}
          <div className="stay-search-bar-wrap">
            <div className="stay-search-input-box">
              <MagnifyingGlass size={18} className="stay-search-icon" />
              <input
                type="text"
                value={stayLocation}
                onChange={(e) => setStayLocation(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") doSearchHotels();
                }}
                placeholder="Where are you staying?"
              />
              {stayLocation && (
                <button
                  className="stay-clear-btn"
                  onClick={() => setStayLocation("")}
                >
                  <X size={14} />
                </button>
              )}
            </div>

            <div className="stay-date-controls">
              <div className="google-date-picker-box">
                <div className="google-date-half">
                  <CalendarBlank size={16} className="google-date-icon" />
                  <span className="google-date-value">
                    {formatDisplayDate(checkIn, "Check-in")}
                  </span>
                  <div className="google-date-steppers">
                    <button
                      type="button"
                      className="google-date-step"
                      onClick={(e) => {
                        e.stopPropagation();
                        stepDate(setCheckIn, checkIn, -1);
                      }}
                      title="Previous day"
                    >
                      <CaretLeft size={13} />
                    </button>
                    <button
                      type="button"
                      className="google-date-step"
                      onClick={(e) => {
                        e.stopPropagation();
                        stepDate(setCheckIn, checkIn, 1);
                      }}
                      title="Next day"
                    >
                      <CaretRight size={13} />
                    </button>
                  </div>
                  <input
                    type="date"
                    className="google-hidden-date-input"
                    value={checkIn}
                    onChange={(e) => setCheckIn(e.target.value)}
                    aria-label="Check-in date"
                  />
                </div>

                <div className="google-date-divider" />

                <div className="google-date-half">
                  <span className="google-date-value">
                    {formatDisplayDate(checkOut, "Check-out")}
                  </span>
                  <div className="google-date-steppers">
                    <button
                      type="button"
                      className="google-date-step"
                      onClick={(e) => {
                        e.stopPropagation();
                        stepDate(setCheckOut, checkOut, -1);
                      }}
                      title="Previous day"
                    >
                      <CaretLeft size={13} />
                    </button>
                    <button
                      type="button"
                      className="google-date-step"
                      onClick={(e) => {
                        e.stopPropagation();
                        stepDate(setCheckOut, checkOut, 1);
                      }}
                      title="Next day"
                    >
                      <CaretRight size={13} />
                    </button>
                  </div>
                  <input
                    type="date"
                    className="google-hidden-date-input"
                    value={checkOut}
                    onChange={(e) => setCheckOut(e.target.value)}
                    aria-label="Check-out date"
                  />
                </div>
              </div>

              <div className="stay-guests-pill">
                <Users size={14} />

                <div className="passenger-count-wrap">
                  <span className="stepper-value">{guests}</span>

                  <div className="vertical-stepper">
                    <button
                      type="button"
                      className="stepper-btn"
                      onClick={() => setGuests(Math.min(20, guests + 1))}
                    >
                      ▲
                    </button>

                    <button
                      type="button"
                      className="stepper-btn"
                      onClick={() => setGuests(Math.max(1, guests - 1))}
                    >
                      ▼
                    </button>
                  </div>
                </div>

                <span className="stay-guests-label">
                  {guests === 1 ? "guest" : "guests"}
                </span>
              </div>

              <button
                className="btn btn-primary stay-search-submit-btn"
                onClick={doSearchHotels}
                disabled={loading}
              >
                Search
              </button>
            </div>
          </div>

          {/* Filter Pills Row (from Image 1) */}
          <div className="travel-filter-pills-row">
            <button
              className={`travel-pill ${activeHotelFilter === "all" ? "active" : ""}`}
              onClick={() => setActiveHotelFilter("all")}
            >
              <SlidersHorizontal size={14} />
              <span>All filters</span>
            </button>
            <button
              className={`travel-pill ${activeHotelFilter === "pool" ? "active" : ""}`}
              onClick={() => setActiveHotelFilter(activeHotelFilter === "pool" ? "all" : "pool")}
            >
              Pool
            </button>
            <button
              className={`travel-pill ${activeHotelFilter === "4plus" ? "active" : ""}`}
              onClick={() => setActiveHotelFilter(activeHotelFilter === "4plus" ? "all" : "4plus")}
            >
              4+ rating
            </button>
            <button
              className={`travel-pill ${activeHotelFilter === "fitness" ? "active" : ""}`}
              onClick={() => setActiveHotelFilter(activeHotelFilter === "fitness" ? "all" : "fitness")}
            >
              Fitness center
            </button>
            <button
              className={`travel-pill ${activeHotelFilter === "wifi" ? "active" : ""}`}
              onClick={() => setActiveHotelFilter(activeHotelFilter === "wifi" ? "all" : "wifi")}
            >
              Free Wi-Fi
            </button>

            {/* Track prices toggle */}
            <div className="travel-track-prices-wrap">
              <label className="travel-track-label" htmlFor="track-prices-hotel">
                <span>Track prices</span>
              </label>
              <input
                id="track-prices-hotel"
                type="checkbox"
                className="travel-toggle"
                checked={trackPrices}
                onChange={(e) => setTrackPrices(e.target.checked)}
              />
            </div>
          </div>

          {/* Results Header */}
          <div className="travel-results-count-bar">
            <span>near {stayLocation} · {hotels.length} results</span>
          </div>

          {/* Hotel Result Cards List */}
          <div className="stay-results-list">
            {hotels.map((hotel) => (
              <div key={hotel.id} className="stay-card-horizontal">
                {/* Photo with carousel dots and badges */}
                <div
                  className="stay-card-photo"
                  style={{ backgroundImage: `url('${hotel.img || "/images/alfama.jpg"}')` }}
                >
                  {hotel.dealBadge && (
                    <span className="stay-deal-badge">{hotel.dealBadge}</span>
                  )}
                  <button
                    className={`stay-bookmark-btn ${savedProperties[hotel.id] ? "saved" : ""}`}
                    onClick={() => toggleBookmark(hotel.id)}
                    aria-label="Save hotel"
                  >
                    <BookmarkSimple size={18} weight={savedProperties[hotel.id] ? "fill" : "bold"} />
                  </button>
                  <div className="stay-photo-dots">
                    <span className="dot active" />
                    <span className="dot" />
                    <span className="dot" />
                  </div>
                </div>

                {/* Hotel Details */}
                <div className="stay-card-info">
                  <div className="stay-card-header">
                    <h3 className="stay-card-name">{hotel.name}</h3>
                    <div className="stay-card-rating">
                      <span className="rating-score">{hotel.rate}</span>
                      <Star size={14} weight="fill" className="rating-star" />
                      <span className="rating-count">({hotel.reviews})</span>
                    </div>
                  </div>

                  <div className="stay-card-area">{hotel.area}</div>

                  {hotel.amenities && (
                    <div className="stay-amenities-row">
                      {hotel.amenities.map((am, i) => (
                        <span key={i} className="stay-amenity-item">
                          {am}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Pricing & CTA */}
                <div className="stay-card-tail">
                  <div className="stay-price-stack">
                    {hotel.dealBadge && (
                      <span className="stay-tail-deal">{hotel.dealBadge}</span>
                    )}
                    <span className="stay-card-price">{hotel.price}</span>
                  </div>

                  <button
                    className="stay-google-btn"
                    onClick={() => handleGoogleHotelSearch(hotel.name)}
                  >
                    View details
                  </button>

                  <button
                    className="btn btn-primary stay-cta-btn"
                    onClick={() => handleSelectHotel(hotel)}
                  >
                    Select
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 3: VACATION RENTALS (Matches Image 2) */}
      {/* ========================================================================= */}
      {activeTab === "rentals" && (
        <div className="travel-tab-content">
          {/* Vacation Rentals Search Bar */}
          <div className="stay-search-bar-wrap">
            <div className="stay-search-input-box">
              <MagnifyingGlass size={18} className="stay-search-icon" />
              <input
                type="text"
                value={stayLocation}
                onChange={(e) => setStayLocation(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") doSearchRentals();
                }}
                placeholder="Where to stay?"
              />
              {stayLocation && (
                <button
                  className="stay-clear-btn"
                  onClick={() => setStayLocation("")}
                >
                  <X size={14} />
                </button>
              )}
            </div>

            <div className="stay-date-controls">
              <div className="google-date-picker-box">
                <div className="google-date-half">
                  <CalendarBlank size={16} className="google-date-icon" />
                  <span className="google-date-value">
                    {formatDisplayDate(checkIn, "Check-in")}
                  </span>
                  <div className="google-date-steppers">
                    <button
                      type="button"
                      className="google-date-step"
                      onClick={(e) => {
                        e.stopPropagation();
                        stepDate(setCheckIn, checkIn, -1);
                      }}
                      title="Previous day"
                    >
                      <CaretLeft size={13} />
                    </button>
                    <button
                      type="button"
                      className="google-date-step"
                      onClick={(e) => {
                        e.stopPropagation();
                        stepDate(setCheckIn, checkIn, 1);
                      }}
                      title="Next day"
                    >
                      <CaretRight size={13} />
                    </button>
                  </div>
                  <input
                    type="date"
                    className="google-hidden-date-input"
                    value={checkIn}
                    onChange={(e) => setCheckIn(e.target.value)}
                    aria-label="Check-in date"
                  />
                </div>

                <div className="google-date-divider" />

                <div className="google-date-half">
                  <span className="google-date-value">
                    {formatDisplayDate(checkOut, "Check-out")}
                  </span>
                  <div className="google-date-steppers">
                    <button
                      type="button"
                      className="google-date-step"
                      onClick={(e) => {
                        e.stopPropagation();
                        stepDate(setCheckOut, checkOut, -1);
                      }}
                      title="Previous day"
                    >
                      <CaretLeft size={13} />
                    </button>
                    <button
                      type="button"
                      className="google-date-step"
                      onClick={(e) => {
                        e.stopPropagation();
                        stepDate(setCheckOut, checkOut, 1);
                      }}
                      title="Next day"
                    >
                      <CaretRight size={13} />
                    </button>
                  </div>
                  <input
                    type="date"
                    className="google-hidden-date-input"
                    value={checkOut}
                    onChange={(e) => setCheckOut(e.target.value)}
                    aria-label="Check-out date"
                  />
                </div>
              </div>

              <div className="stay-guests-pill">
                <Users size={14} />

                <div className="passenger-count-wrap">
                  <span className="stepper-value">{guests}</span>

                  <div className="vertical-stepper">
                    <button
                      type="button"
                      className="stepper-btn"
                      onClick={() => setGuests(Math.min(20, guests + 1))}
                    >
                      ▲
                    </button>

                    <button
                      type="button"
                      className="stepper-btn"
                      onClick={() => setGuests(Math.max(1, guests - 1))}
                    >
                      ▼
                    </button>
                  </div>
                </div>

                <span className="stay-guests-label">
                  {guests === 1 ? "guest" : "guests"}
                </span>
              </div>

              <button
                className="btn btn-primary stay-search-submit-btn"
                onClick={doSearchRentals}
                disabled={loading}
              >
                Search
              </button>
            </div>
          </div>

          {/* Filter Pills Row (from Image 2) */}
          <div className="travel-filter-pills-row">
            <button
              className={`travel-pill ${rentalTypeFilter === "all" ? "active" : ""}`}
              onClick={() => setRentalTypeFilter("all")}
            >
              <SlidersHorizontal size={14} />
              <span>All filters</span>
            </button>
            <button
              className={`travel-pill ${rentalTypeFilter === "House" ? "active" : ""}`}
              onClick={() => setRentalTypeFilter(rentalTypeFilter === "House" ? "all" : "House")}
            >
              Houses
            </button>
            <button
              className={`travel-pill ${rentalTypeFilter === "Apartment" ? "active" : ""}`}
              onClick={() => setRentalTypeFilter(rentalTypeFilter === "Apartment" ? "all" : "Apartment")}
            >
              Apartments
            </button>
          </div>

          {/* Sponsored Horizontal Carousel (from Image 2) */}
          <div className="rentals-sponsored-section">
            <div className="rentals-sponsored-header">
              <span className="eyebrow">Sponsored · {stayLocation} stays</span>
            </div>
            <div className="rentals-sponsored-scroll">
              {rentals.slice(0, 3).map((item) => (
                <div key={`spon-${item.id}`} className="rentals-sponsored-card">
                  <div
                    className="rentals-sponsored-img"
                    style={{ backgroundImage: `url('${item.img || "/images/alfama.jpg"}')` }}
                  />
                  <div className="rentals-sponsored-details">
                    <div className="rentals-sponsored-title">{item.name}</div>
                    <div className="rentals-sponsored-price">{item.price}</div>
                    <div className="rentals-sponsored-sub">
                      {item.provider ? `${item.provider} · ` : ""}
                      {item.rate ? `★ ${item.rate}` : ""}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Results Header */}
          <div className="travel-results-count-bar">
            <span>{stayLocation} · {rentals.length} results</span>
          </div>

          {/* Vacation Rentals List */}
          <div className="stay-results-list">
            {rentals.map((rental) => (
              <div key={rental.id} className="stay-card-horizontal">
                {/* Photo */}
                <div
                  className="stay-card-photo"
                  style={{ backgroundImage: `url('${rental.img || "/images/alfama.jpg"}')` }}
                >
                  <button
                    className={`stay-bookmark-btn ${savedProperties[rental.id] ? "saved" : ""}`}
                    onClick={() => toggleBookmark(rental.id)}
                    aria-label="Save rental"
                  >
                    <BookmarkSimple size={18} weight={savedProperties[rental.id] ? "fill" : "bold"} />
                  </button>
                  <div className="stay-photo-dots">
                    <span className="dot active" />
                    <span className="dot" />
                    <span className="dot" />
                  </div>
                </div>

                {/* Details */}
                <div className="stay-card-info">
                  <div className="stay-card-header">
                    <h3 className="stay-card-name">{rental.name}</h3>
                    <div className="stay-card-rating">
                      <span className="rating-score">{rental.rate}</span>
                      <Star size={14} weight="fill" className="rating-star" />
                      <span className="rating-count">({rental.reviews})</span>
                    </div>
                  </div>

                  <div className="stay-card-area">{rental.area}</div>

                  {rental.specs && (
                    <div className="stay-specs-grid">
                      <span>{rental.specs.propertyType || "Home"}</span>
                      <span>· Sleeps {rental.specs.sleeps || 2}</span>
                      <span>· {rental.specs.bedrooms || 1} bedroom</span>
                      <span>· {rental.specs.bathrooms || 1} bath</span>
                    </div>
                  )}

                  {rental.amenities && (
                    <div className="stay-amenities-row">
                      {rental.amenities.slice(0, 4).map((am, i) => (
                        <span key={i} className="stay-amenity-item">{am}</span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Tail */}
                <div className="stay-card-tail">
                  <div className="stay-price-stack">
                    <span className="stay-card-price">{rental.price}</span>
                  </div>

                  <button
                    className="stay-google-btn"
                    onClick={() => handleGoogleHotelSearch(rental.name)}
                  >
                    View details
                  </button>

                  <button
                    className="btn btn-primary stay-cta-btn"
                    onClick={() => handleSelectRental(rental)}
                  >
                    Select
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
