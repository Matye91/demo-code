"use strict";

/* Functionality of the page Kundenliste */

// predefine global variables
// prettier-ignore
let form, klBodyEl, searchResultsEl, pagnationEls, pageinfoEl, gebietButton, searchButton, currentPageEl, lastPage, pagnPageEls, scrollformEl, tableWithloadWheel, urlOrigin, map, nextArea;

const state = {
  mode: "",
};

////////////////////////////////////
// "global" functions (need to be called after DOM loaded in WordPress)
document.addEventListener("DOMContentLoaded", function () {
  // define DOM Elements
  form = document.getElementById("searchForm");
  searchResultsEl = document.querySelector(".search-results");
  pageinfoEl = document.querySelector(".pageinfo");

  searchButton = document.getElementById("searchButton");
  gebietButton = document.getElementById("gebiet");

  currentPageEl = document.getElementById("curPage");

  pagnationEls = document.querySelectorAll(".pagnationContainer");

  scrollformEl = document.querySelector(".scrollform");
  tableWithloadWheel = scrollformEl.innerHTML;

  urlOrigin = document.URL.split("/kundenliste/")[0];

  // create the inital state from the URL
  const currentUrlSplit = window.location.search.substring(1).split("&");
  currentUrlSplit.forEach((pair) => {
    const [key, value] = pair.split("=");
    if (!key) return;
    state[key] = value;
  });

  // call init function(s)
  loadCustomers();

  // event handler: click of submit button
  searchButton.addEventListener("click", submitForm);

  // event handler: change of gebiet dropdown
  gebietButton.addEventListener("change", submitForm);
});

////////////////////////////////////
/* helper functions */
const timeout = function (s) {
  return new Promise(function (_, reject) {
    setTimeout(function () {
      reject(new Error(`Request took too long! Timeout after ${s} second`));
    }, s * 1000);
  });
};

////////////////////////////////////
/* General Functions */

// updates the state array, the URL and the form entries
// usage example: updateState({ curPage: 1, gebiet: 2 });
const updateState = function (updates) {
  let field;
  for (const key in updates) {
    if (updates.hasOwnProperty(key)) {
      // 1.) update the state
      state[key] = updates[key];

      // 2.) update the form
      field = document.getElementById(key).value = updates[key];
    }
  }

  // 3.) update the url
  const newURLString = Object.entries(state)
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(value)}`
    )
    .join("&");
  window.history.replaceState(null, "", `?${newURLString}`);

  return;
};

// handles the submit of the search/filter form
const submitForm = function (e) {
  e = e || window.event;
  e?.preventDefault();

  currentPageEl.value = 1; // jump back to page #1

  processForm();

  loadCustomers();
};

// collects data from the search/filter form and updates the state
const processForm = function () {
  // collect all data from the search form
  const updates = {};
  Array.from(form.elements).forEach((element) => {
    if (element.id && element.type !== "submit") {
      updates[element.id] = sanitizeInput(element.value).trim();
    }
  });

  // overwrite the state with the form data
  updateState(updates);
};

// on pagination clicks: checks, updates state to new page and reloads the table/map
const pageChumper = function (e, seite) {
  e = e || window.event;
  e?.preventDefault();

  // dont jump to any pages after the last one
  seite = seite > lastPage ? lastPage : seite;

  // change the page to the new page
  updateState({ curPage: seite });

  // reload customers
  loadCustomers();
};

const colorSelector = function (selectedColor) {
  // prettier-ignore
  const farbcodeArray = {null: "Farbcode", black: "schwarz", lightblue: "blau", xxxFF00008F: "rot", xxxFFC65E: "orange", yellow: "gelb", xxx7bed7b: "gr&uuml;n", lightpink: "pink", };

  let colorSelection;
  let colorSelected;
  Object.entries(farbcodeArray).forEach(([key, value], index) => {
    colorSelected = selectedColor == key ? "selected" : "";
    colorSelection += `<option value="${key}" ${colorSelected}>${value}</option>`;
  });
  return colorSelection;
};

/* Map Mode */

class CustomerMap {
  #map;
  #preloadedCustomers = [];
  notFoundCust = [];
  coordsToBeStored = [];
  getCoordsCount = 0;
  getCoordsRuns = 0;
  lastAPIKeyIndex = 0;

  constructor(useGeoCoordsAPI) {
    this.useGeoCoordsAPI = useGeoCoordsAPI;
    this.#getPosition();

    this.BKflagIcon = L.AwesomeMarkers.icon({
      icon: "plus",
      markerColor: "green",
      prefix: "fa",
    });

    this.NKflagIcon = L.AwesomeMarkers.icon({
      icon: "flag",
      markerColor: "cadetblue",
      prefix: "fa",
    });
  }

  #getPosition() {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        this.#loadMap(position, "Du bist hier!");
      },

      () => {
        let pos = { coords: { latitude: 47.1042968, longitude: 15.4966942 } };
        this.#loadMap(pos, "Panda Office GmbH");
      }
    );
  }

  #loadMap(position, message) {
    //destructure coords
    const { latitude, longitude } = position.coords;
    const coords = [latitude, longitude];

    // focus map
    this.#map = L.map("map").setView(coords, 13);

    L.tileLayer("https://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}", {
      maxZoom: 20,
      subdomains: ["mt0", "mt1", "mt2", "mt3"],
    }).addTo(this.#map);

    const homeMarker = L.AwesomeMarkers.icon({
      icon: "home",
      markerColor: "darkgreen",
      prefix: "fa",
    });

    L.marker(coords, { icon: homeMarker })
      .addTo(this.#map)
      .bindPopup(message)
      .openPopup();

    // events that update the markers
    this.#map.on("zoomend", this.updateMarker.bind(this));
    this.#map.on("moveend", this.updateMarker.bind(this));
  }

  preloadCustomer(data) {
    let newCustomer = new Customer(data);
    this.#preloadedCustomers.push(newCustomer);
  }

  // create markers in visible area and delete those outside
  updateMarker() {
    const bounds = this.#map.getBounds();
    const currentZoom = this.#map.getZoom();
    const maxZoom = 13;

    this.#preloadedCustomers.forEach((customer) => {
      // if the zoom is too large, delete flags and only show bubbles
      if (currentZoom < maxZoom) {
        if (customer.markerObj) {
          this.#map.removeLayer(customer.markerObj);
          customer.markerObj = null;
        }
        return;
      }

      const customerLatLng = L.latLng(customer.latitude, customer.longitude);

      // if LatLng undefined, log error and delete possible marker
      if (!customerLatLng) {
        console.log(
          "customerLatLng undefined: ",
          customerLatLng,
          customer.latitude,
          customer.longitude,
          customer
        );
        if (customer.markerObj) {
          this.#map.removeLayer(customer.markerObj);
          customer.markerObj = null;
        }
        return;
      }

      if (bounds.contains(customerLatLng)) {
        // if no marker shown, show marker and set true
        if (!customer.markerObj) {
          customer.markerObj = L.marker(
            [customer.latitude, customer.longitude],
            { icon: customer.flagIcon }
          )
            .addTo(this.#map)
            .bindPopup(
              L.popup({
                className: `${customer.kdnr != "0" ? "BK" : "NK"}-marker`,
              })
            )
            .setPopupContent(customer.flagStr);
        }
      } else {
        // if marker is shown, delete the marker
        if (customer.markerObj) {
          this.#map.removeLayer(customer.markerObj);
          customer.markerObj = null;
        }
      }
    });
  }

  // save all unstored coords to DB
  saveCoordsToDB() {
    const nonce_ID = document.getElementById("Terminieren_nonce").value;

    // store IDs, and coords array in other variable to be able to clear directly after
    const coordsArray = [...map.coordsToBeStored];

    // empty the array
    map.coordsToBeStored = [];

    console.log(
      `saveCoordsToDB: saving ${coordsArray.length} coords to DB`,
      coordsArray
    );

    // ajax Kunden Koordinaten speichern *************
    $.ajax({
      url: siteConfig.ajaxurl,
      type: "post",
      data: {
        action: "saveCoords",
        ajax_nonce: nonce_ID,
        data: coordsArray,
      },
      success: function (response) {
        if (response != "") {
          console.log(response);
        }
      },
      error: function (response, xhr, textStatus, errorThrown) {
        console.log(
          "AJAX Error:",
          response,
          textStatus,
          errorThrown,
          xhr.responseText
        );
      },
    });
  }

  // save all not found addresses to DB, so that they are not inquired over and over again
  saveUnfoundToDB() {
    const nonce_ID = document.getElementById("Terminieren_nonce").value;

    // store IDs of array in other variable to be able to clear directly after
    const unfoundArray = [...map.notFoundCust];

    // empty the array
    map.notFoundCust = [];

    console.log(
      `Saving ${unfoundArray.length} unfound addresses to DB`,
      unfoundArray
    );

    //ajax Kunden Koordinaten speichern *************
    $.ajax({
      url: siteConfig.ajaxurl,
      type: "post",
      data: {
        action: "saveUnfound",
        ajax_nonce: nonce_ID,
        data: unfoundArray,
      },
      success: function (response) {
        if (response != "") {
          console.log(response);
        }
      },
      error: function (response, xhr, textStatus, errorThrown) {
        console.log(
          "AJAX Error:",
          response,
          textStatus,
          errorThrown,
          xhr.responseText
        );
      },
    });
  }
}

class Customer {
  markerObj = false;

  constructor(data) {
    this.ansprechperson = data.Ansprechperson || "";
    this.anzahlMA = data.AnzahlMA || "0";
    this.branche = data.Branche || "";
    this.farbcode = data.Farbcode || "";
    this.id = data.ID || "";
    this.kdnr = data.Kdnr || "";
    this.kommentar = data.Kommentar || "";
    this.kundenname = data.Kundenname;
    this.ort = data.Ort || "";
    this.plz = data.PLZ || "";
    this.strasse = data.Strasse || "";
    this.telefon = data.Telefon || "";
    this.kontaktDatum = data.kontaktDatum || "";
    this.kontaktVertreter = data.kontaktVertreter || "";
    this.latitude = Number(data.latitude) || 0;
    this.longitude = Number(data.longitude) || 0;

    this.geocodeGoogle = data.geocode_google || "";
    this.geocodeMapsCo = data.geocode_maps_co || "";

    // if either lat or lon from database are 0 and gate passed, get via API
    if (
      (this.latitude === 0 || this.longitude === 0) &&
      map.useGeoCoordsAPI === true
    ) {
      Customer._enqueue(this);
    }

    this.#createFlagStr();
    this.#createFlagIcon();
  }

  #createFlagStr() {
    const KdIDstr = this.kdnr != 0 ? `KdNr.: ${this.kdnr} <br> ` : "";
    const AnsprpersStr =
      this.ansprechperson != "" ? `${this.ansprechperson} <br> ` : "";
    const teleStr =
      this.telefon != ""
        ? `<input type="hidden" id="tele[${this.id}]" name="tele[${this.id}]" value="${this.telefon}"><a class="kundentelefon" onclick="startCall(${this.id}, &quot;Kundenliste&quot;);" title="Jetzt ${this.kundenname} anrufen">${this.telefon}</a></input>`
        : "";
    const flagMarker = `${KdIDstr}<b><a href="${urlOrigin}/kundenblatt/?KdID=${this.id}" target="_blank" title="zum Kundenblatt">${this.kundenname}</a></b> <br> ${AnsprpersStr} ${this.strasse}, <br>${this.plz} ${this.ort}<br>${teleStr} `;
    this.flagStr = flagMarker;
    return flagMarker;
  }

  #createFlagIcon() {
    // icon for BKs
    if (Number(this.kdnr) != 0) {
      this.flagIcon = map.BKflagIcon;
      return this.flagIcon;
    }

    // default icon
    this.flagIcon = map.NKflagIcon;
    return this.flagIcon;
  }

  // queue the API requests
  static queue = [];
  static isProcessing = false;

  static _enqueue(customer) {
    this.queue.push(customer);
    if (!this.isProcessing) {
      this._processQueue();
    }
  }

  static async _processQueue() {
    // if the end of the queue stop
    if (this.queue.length === 0) {
      this.isProcessing = false;
      return;
    }

    this.isProcessing = true;

    const customer = this.queue.shift();
    console.log(
      `processing queue at length ${this.queue.length + 1} for KdID ${
        customer.id
      }!`
    );
    await customer.#getLatLon();

    // saving to DB every 100 iterations (includes last run, cause 0 % 100 = 0)
    if (this.queue.length % 100 === 0) {
      if (map.coordsToBeStored.length > 0) {
        map.saveCoordsToDB();
      }
      if (map.notFoundCust.length > 0) {
        map.saveUnfoundToDB();
      }
    }

    // Process the next item in the queue after a delay
    setTimeout(() => this._processQueue(), 1200);
  }

  async #getLatLon() {
    const address = `${this.strasse.split(/[/,]/)[0]}, ${this.plz} ${this.ort}`;
    map.getCoordsCount++;

    try {
      const coordinates = await this.#getCoordinates(address, this.id);
      if (!coordinates) {
        console.log(`No coordinates found for ${address}`);
        return Promise.resolve();
      }
      if (coordinates === "unfound") {
        console.log("getLatLon: Coords already marked unfound!");
        return Promise.resolve();
      }
      const { lat, lng } = coordinates;
      this.latitude = lat;
      this.longitude = lng;
      return Promise.resolve();
    } catch (error) {
      console.log("getLatLon: Function failed", error);
      return Promise.resolve();
    }
  }

  // fetch coords function
  async #getCoordinates(address, KdID) {
    // if MaJun.io (Demo Version) => return fake coords around Austria
    if (window.location.hostname === "www.majun.io") {
      // Define the bounding box for Austria
      const minLat = 46.372276;
      const maxLat = 49.02053;
      const minLng = 13.072399;
      const maxLng = 17.160686;

      // Generate random latitude and longitude within the bounds
      const latitude = Math.random() * (maxLat - minLat) + minLat;
      const longitude = Math.random() * (maxLng - minLng) + minLng;
      const lat = parseFloat(latitude.toFixed(6));
      const lon = parseFloat(longitude.toFixed(6));
      this.#gatherCoords(lat, lon, KdID);
      return { lat, lon };
    }

    // if life version, get real coords

    // if this address has not been found in the past, short dont check again
    if (this.geocodeMapsCo === "unfound") {
      return Promise.resolve("unfound");
    }

    const apiKey = [
      "----sample-code-masked----",
      "----sample-code-masked----",
      "----sample-code-masked----",
    ];

    const getNextKey = () => {
      const key = apiKey[map.lastAPIKeyIndex];
      map.lastAPIKeyIndex = (map.lastAPIKeyIndex + 1) % apiKey.length;
      return key;
    };

    const url = `https://geocode.maps.co/search?q=${encodeURIComponent(
      address
    )}&api_key=${getNextKey()}`;

    try {
      const response = await Promise.race([fetch(url), timeout(10)]);
      if (!response.ok) {
        throw new Error("Network response was not ok");
      }
      const data = await response.json();

      if (data.length > 0) {
        const lat = data[0].lat;
        const lon = data[0].lon;
        this.#gatherCoords(lat, lon, KdID);
        return { lat, lon };
      } else {
        this.#coordsNotFound();
        return Promise.resolve(null);
      }
    } catch (error) {
      console.error(
        "There has been a problem with the fetch operation:",
        error
      );
      return Promise.resolve(null);
    }
  }

  // gather all coords to be stored to DB
  #gatherCoords(lat, lon, KdID) {
    map.coordsToBeStored.push({ lat: lat, lon: lon, KdID: KdID });
  }

  // method in case coords not found
  #coordsNotFound() {
    map.notFoundCust.push({ KdID: this.id });
  }
}

const loadCustomers = function () {
  // place table with loading wheel
  scrollformEl.innerHTML = tableWithloadWheel;
  // reset this variable due to the new DOM element
  klBodyEl = document.getElementById("KLBody");

  const nonce_ID = document.getElementById("Terminieren_nonce").value;

  // if map mode, collect data by patches
  if (state["mode"] === "map") {
    // overwrite curPage to always start at 1
    let curPage = 1;
    lastPage = 1;
    const maxEntries = 100000;
    const entriesPerPage = 1000;

    // if less <= entriesPerPage results per patch, change patch too entriesPerPage
    if (Number(state["results"]) < entriesPerPage) {
      state["results"] = entriesPerPage;
    }

    // delte Page info and pagnation in general in map mode
    pageinfoEl.textContent = "";
    pagnationEls.forEach((pagnation) => (pagnation.innerHTML = "-"));

    // replace loading div with map div
    scrollformEl.innerHTML = "<div id='map'></div>";

    // Init the map
    map = new CustomerMap(useGeoCoordsAPI);

    // call all batches until all data have been loaded
    function ajaxLoadCustomers(curPage) {
      console.log(
        `${curPage} <= ${lastPage}: ${
          curPage <= lastPage ? "start new loop" : "end looping"
        }`
      );

      console.log("requesting data with: ", state);

      // overwrite the data to the php request
      state["curPage"] = curPage;

      // ajax Kundendaten laden *************
      $.ajax({
        url: siteConfig.ajaxurl,
        type: "post",
        data: {
          action: "loadCustomers",
          ajax_nonce: nonce_ID,
          searchData: state,
        },
        success: function (response) {
          let allData = JSON.parse(response);
          console.log("Incoming data:", allData);

          let data = allData.customers;
          let viewerID = allData.viewerID;

          // bei 0 Suchergebnissen ---
          if (!data) {
            klBodyEl.innerHTML =
              '<tr><td colspan="100%" class="spaceholder--kundenliste">leider keine Suchergebnisse</td></tr>';

            // update pagenation and page info
            searchResultsEl.textContent = `0 Suchergebnisse`;

            lastPage = 0;
            return;
          }

          // update only at first loop
          if (curPage === 1) {
            // update pagenation and page info
            searchResultsEl.textContent = `${new Intl.NumberFormat(
              "de-DE"
            ).format(allData.number_of_result)} Suchergebnisse`;

            lastPage = allData.number_of_page;
          }

          // loop through each customer in the JSON-file
          for (let i = 0; i < data.length; i++) {
            if (data[i]) {
              // create new customer object
              map.preloadCustomer(data[i]);
            }
          }

          // if there are more pages, load the next page
          if (curPage < lastPage && curPage < maxEntries / state["results"]) {
            ajaxLoadCustomers(curPage + 1);
          } else {
            // if this was the final page, updateMarker and saveCoords to DB
            console.log(`last page reached: ${curPage}`);

            // update all markers after every patch
            map.updateMarker();
          }
        },
        error: function (response) {
          // collect the h3 element from the error response
          var parser = new DOMParser();
          var doc = parser.parseFromString(responseText, "text/html");
          var h3Content = doc.querySelector("h3").textContent;

          // Log detailed error information to the console for debugging
          console.log(
            `${response.status} AJAX Error while loadCustomers:`,
            response,
            response.responseText
          );

          // Display error message to the user
          alert(`loadCustomers: AJAX Transfer Fehler! Ursache: ${h3Content}`);

          return;
        },
      });
    }

    // Start loading the first page
    ajaxLoadCustomers(curPage);
  }

  // if not map mode (=list mode) collect data by page as given
  if (state["mode"] === "list" || !state["mode"]) {
    console.log("requesting data with: ", state);
    $.ajax({
      url: siteConfig.ajaxurl,
      type: "post",
      data: {
        action: "loadCustomers",
        ajax_nonce: nonce_ID,
        searchData: state,
      },
      success: function (response) {
        let allData = JSON.parse(response);
        console.log(allData);

        let data = allData.customers;
        let viewerID = allData.viewerID;
        let KdnStammdaten = allData.KdnStammdaten;

        // bei 0 Suchergebnissen ---
        if (!data) {
          klBodyEl.innerHTML =
            '<tr><td colspan="100%" class="spaceholder--kundenliste">leider keine Suchergebnisse</td></tr>';

          // update pagenation and page info
          searchResultsEl.textContent = `0 Suchergebnisse`;
          pagnationEls.forEach((pagnation) => (pagnation.innerHTML = "-"));
          pageinfoEl.textContent = `Seite 1 / 1`;
          lastPage = 0;
          return;
        }

        // update pagenation and page info
        searchResultsEl.textContent = `${new Intl.NumberFormat("de-DE").format(
          allData.number_of_result
        )} Suchergebnisse`;
        pagnationEls.forEach(
          (pagnation) => (pagnation.innerHTML = allData.kundenliste_pagnation)
        );
        pageinfoEl.textContent = `Seite ${new Intl.NumberFormat("de-DE").format(
          allData.seite
        )} / ${new Intl.NumberFormat("de-DE").format(allData.number_of_page)}`;
        lastPage = allData.number_of_page;

        const urlOrigin = document.URL.split("/kundenliste/")[0];

        let output = "";
        let KdSubliments = {};
        //loop through all lines fetched
        for (let i = 0; i < data.length; i++) {
          if (data[i]) {
            //prepare the data for the table ----

            // Kdnr format
            if (data[i]["Kdnr"]) {
              data[i]["Kdnr"] =
                Number(data[i]["Kdnr"]) === 0 ? "" : Number(data[i]["Kdnr"]);
            }

            // Branche format
            let key = `item${i}`; // Create a unique key for each item, for example
            data[i].AnzahlMA = data[i].AnzahlMA ? Number(data[i].AnzahlMA) : 0;
            KdSubliments[key] = "";
            if (data[i]["Branche"] || data[i]["AnzahlMA"] !== 0) {
              KdSubliments[key] += "<br><span class='Font09em'>(";
              KdSubliments[key] += data[i]["Branche"] ? data[i]["Branche"] : "";
              KdSubliments[key] +=
                data[i]["Branche"] &&
                (data[i]["AnzahlMA"] && data[i]["AnzahlMA"]) !== 0
                  ? " | "
                  : "";
              KdSubliments[key] +=
                data[i]["AnzahlMA"] && data[i]["AnzahlMA"] !== 0
                  ? `Mitarbeiter: ${data[i]["AnzahlMA"]}`
                  : "";
              KdSubliments[key] += ")</span>";
            }

            // Farbocode auswahl formatieren
            let colorSelection = colorSelector(data[i]["Farbcode"]);

            // Zeilen Farbe formatieren
            let zeilenfarbe = "";
            if (data[i]["Farbcode"]) {
              if (data[i]["Farbcode"].slice(0, 3) === "xxx") {
                zeilenfarbe = "#" + data[i]["Farbcode"].substring(3);
              } else {
                zeilenfarbe = data[i]["Farbcode"];
              }
            }

            let urlBstlSys = "";
            if (window.location.hostname === "www.panda-office.at") {
              urlBstlSys = document.URL.split("/WPv2019/kundenliste/")[0];
            } else if (window.location.hostname === "www.majun.io") {
              urlBstlSys = document.URL.split(
                "/vertriebsportal/kundenliste/"
              )[0];
            }

            // create table content
            output += `<tr id="ID[${data[i]["ID"]}]" style="background-color: ${zeilenfarbe};">`;

            output += `<td><span name="span-kdnr[${data[i]["ID"]}]" id="span-kdnr[${data[i]["ID"]}]"><input class="zeiterfinput kundenliste-kdnr-input" type="text" id="kdnr[${data[i]["ID"]}]" name="kdnr[${data[i]["ID"]}]" value="${data[i]["Kdnr"]}" size="2" onchange="Autosave(this, &apos;Kundenliste&apos;);"></span></td>`;

            output += `<td class="Kdname"><input type="hidden" id="kundenname[${data[i]["ID"]}]" name="kundenname[${data[i]["ID"]}]" value="${data[i]["Kundenname"]}"><b><a href="${urlOrigin}/kundenblatt/?KdID=${data[i]["ID"]}" target="_blank" title="zum Kundenblatt">${data[i]["Kundenname"]}</a></b>${KdSubliments[key]}</td>`;

            output += `<td class="KundenDaten"><a href="https://maps.google.com/?q=${data[i]["Strasse"]}, ${data[i]["PLZ"]} ${data[i]["Ort"]}" title="in Google Maps öffnen" target="_blank" class="addresslink">${data[i]["Strasse"]}<br>${data[i]["PLZ"]} ${data[i]["Ort"]}</a></td>`;

            output += `<td class="textcenter"><span id="span-tele[${data[i]["ID"]}]" name="span-tele[${data[i]["ID"]}]"><a class="kundentelefon" onclick="startCall(${data[i]["ID"]}, &quot;Kundenliste&quot;);" title="Jetzt ${data[i]["Kundenname"]} anrufen">&phone;</a><br><input class="zeiterfinput kundenliste-tele-input" type="text" id="tele[${data[i]["ID"]}]" name="tele[${data[i]["ID"]}]" value="${data[i]["Telefon"]}" size="13" onchange="Autosave(this, &apos;Kundenliste&apos;);"></span></td>`;

            output += `<td><span id="span-anspr[${data[i]["ID"]}]" name="span-anspr[${data[i]["ID"]}]"><textarea class="zeiterfinput kundenliste-komm-input" id="anspr[${data[i]["ID"]}]" name="anspr[${data[i]["ID"]}]" size="20" onchange="Autosave(this, &apos;Kundenliste&apos;);">${data[i]["Ansprechperson"]}</textarea></span></td>`;

            output += `<td><span id="span-komm[${data[i]["ID"]}]" name="span-komm[${data[i]["ID"]}]"><textarea class="zeiterfinput kundenliste-komm-input" id="komm[${data[i]["ID"]}]" name="komm[${data[i]["ID"]}]" size="20" onchange="Autosave(this, &apos;Kundenliste&apos;);">${data[i]["Kommentar"]}</textarea><span></td>`;

            output += `<td><select class="zeiterfinput kundenliste-color-input" name="color[${data[i]["ID"]}]" id="color[${data[i]["ID"]}]" onchange="Autosave(this, &apos;Kundenliste&apos;);">${colorSelection}</select></td>`;

            output += `<td><span id="span-kontaktDatum[${data[i]["ID"]}]" class="KundenDaten">${data[i]["kontaktDatum"]}</span></td>`;
            output += `<td><span id="span-kontaktVertreter[${data[i]["ID"]}]" class="KundenDaten">${data[i]["kontaktVertreter"]}</span></td>`;

            // Kunden-Bearbeiten Button
            if (KdnStammdaten === "1") {
              output += `<td class="dontPrint" style="background-color: #fff;"><a href="${urlOrigin}/kundendaten/?KdID=${data[i]["ID"]}"><img class="pandabutton" src="${urlOrigin}/wp-content/uploads/2021/12/edit-button.png" width="20px" height="20px" title="Stammdaten ändern" alt="Stammdaten ändern"></a></td>`;
            }
            output += `<td class="dontPrint" style="background-color: #fff;"><a onclick="showAddReminder(&apos;${data[i]["ID"]}&apos;,&apos;Kundenliste&apos;)"><img class="pandabutton" src="${urlOrigin}/wp-content/uploads/2021/12/reminder-button.png" width="20px" height="20px" title="Erinnerung zu zu ${data[i]["Kundenname"]} anlegen" alt="Erinnerung zu zu ${data[i]["Kundenname"]} anlegen"></a></td>`;

            // Bestellsystem Button

            output += `<td class="dontPrint" style="background-color: #fff;"><a href="${urlBstlSys}/BstlSys/eingang/?Kdnr=${data[i]["Kdnr"]}&PandaID=${viewerID}&KdID=${data[i]["ID"]}" target="_blank" rel="noopener"><img class="pandabutton" src="${urlOrigin}/wp-content/uploads/2024/02/shopping-cart.png" width="30px" height="30px" title="Bestellung aufnehmen" alt="Bestellung aufnehmen"></a></td>`;

            output += "</tr>";
          }
          klBodyEl.innerHTML = output;
        }

        // reselct those buttons, since they are created new
        pagnPageEls = document.querySelectorAll(".pagn__page");
        pagnPageEls.forEach((pagnPage) => {
          pagnPage.addEventListener("click", (event) =>
            pageChumper(event, pagnPage.value)
          );
        });
      },
      error: function (response) {
        // collect the h3 element from the error response
        var parser = new DOMParser();
        var doc = parser.parseFromString(responseText, "text/html");
        var h3Content = doc.querySelector("h3").textContent;

        // Log detailed error information to the console for debugging
        console.log(
          `${response.status} AJAX Error while loadCustomers:`,
          response,
          response.responseText
        );

        // Display error message to the user
        alert(`loadCustomers: AJAX Transfer Fehler! Ursache: ${h3Content}`);
      },
    });
  }
};
