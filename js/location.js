
export async function getUserLocation() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject(new Error("Geolocation is not supported by your browser."));
            return;
        }

        navigator.geolocation.getCurrentPosition(
            async (position) => {
                const latitude = position.coords.latitude;
                const longitude = position.coords.longitude;

                console.log("Latitude:", latitude);
                console.log("Longitude:", longitude);

                let address = null;

                try {
                    const params = new URLSearchParams({
                        format: "jsonv2",
                        lat: latitude,
                        lon: longitude,
                        zoom: 10,
                        addressdetails: 1
                    });

                    const response = await fetch(
                        `https://nominatim.openstreetmap.org/reverse?${params}`,
                        {
                            headers: {
                                Accept: "application/json"
                            }
                        }
                    );

                    if (!response.ok) {
                        throw new Error(
                            "Unable to convert coordinates into an address."
                        );
                    }

                    const data = await response.json();
                    const parts = data.address || {};

                    const city =
                        parts.city ||
                        parts.town ||
                        parts.municipality ||
                        parts.city_district ||
                        parts.village ||
                        parts.county ||
                        "";

                    const province =
                        parts.state ||
                        parts.province ||
                        "";

                    const country = parts.country || "";

                    address = [
                        city,
                        province,
                        country
                    ].filter(Boolean).join(", ");

                    if (!address) {
                        address = data.display_name || null;
                    }

                    console.log("Converted location:", address);

                } catch (error) {
                    console.error(
                        "Reverse geocoding failed:",
                        error
                    );
                }

                resolve({
                    latitude,
                    longitude,
                    address
                });
            },
            (error) => {
                reject(new Error(error.message));
            },
            {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 0
            }
        );
    });
}
