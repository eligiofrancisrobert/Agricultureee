
export async function getUserLocation() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject(
                new Error("Geolocation is not supported by your browser.")
            );
            return;
        }

        navigator.geolocation.getCurrentPosition(
            async (position) => {
                const latitude = position.coords.latitude;
                const longitude = position.coords.longitude;
                const accuracy = position.coords.accuracy;

                console.log("Latitude:", latitude);
                console.log("Longitude:", longitude);
                console.log("GPS Accuracy:", accuracy, "meters");

                let address = null;

                try {
                    const params = new URLSearchParams({
                        format: "jsonv2",
                        lat: latitude,
                        lon: longitude,
                        zoom: 18,
                        addressdetails: 1
                    });

                    const response = await fetch(
                        `https://nominatim.openstreetmap.org/reverse?${params}`,
                        {
                            headers: {
                                Accept: "application/json",
                                "Accept-Language": "en"
                            }
                        }
                    );

                    if (!response.ok) {
                        throw new Error(
                            "Unable to convert coordinates into an address."
                        );
                    }

                    const data = await response.json();

                    // Use the complete address returned by OpenStreetMap.
                    address = data.display_name || null;

                    if (address) {
                        console.log("Exact readable location:", address);
                    } else {
                        console.warn(
                            "No readable address was found for these coordinates."
                        );
                    }

                } catch (error) {
                    console.error(
                        "Reverse geocoding failed:",
                        error
                    );
                }

                resolve({
                    latitude,
                    longitude,
                    accuracy,
                    address
                });
            },

            (error) => {
                reject(new Error(error.message));
            },

            {
                enableHighAccuracy: true,
                timeout: 15000,
                maximumAge: 0
            }
        );
    });
}
