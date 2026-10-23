[out:json][timeout:180];
(
  way["highway"](-17.8420,31.0280,-17.8130,31.0650);
  way["building"](-17.8420,31.0280,-17.8130,31.0650);
  relation["building"](-17.8420,31.0280,-17.8130,31.0650);
  way["leisure"~"park|garden|pitch|stadium"](-17.8420,31.0280,-17.8130,31.0650);
  way["landuse"~"grass|recreation_ground|railway|cemetery"](-17.8420,31.0280,-17.8130,31.0650);
  way["railway"="rail"](-17.8420,31.0280,-17.8130,31.0650);
  node["natural"="tree"](-17.8420,31.0280,-17.8130,31.0650);
  nwr["tourism"](-17.8420,31.0280,-17.8130,31.0650);
  nwr["amenity"~"place_of_worship|townhall|bus_station|marketplace"](-17.8420,31.0280,-17.8130,31.0650);
);
out body;
>;
out skel qt;
