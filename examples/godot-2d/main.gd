extends Control
func _ready():
 var title=Label.new()
 title.text="素材工坊 · 2D 地牢素材 / 原始像素图集"
 title.position=Vector2(40,28)
 title.add_theme_font_size_override("font_size",24)
 add_child(title)
 var image=TextureRect.new()
 image.texture=load("res://assets/workshop/tilemap-50ee7a98/8e146f78/Tilemap/tilemap.png")
 image.texture_filter=CanvasItem.TEXTURE_FILTER_NEAREST
 image.position=Vector2(40,100)
 image.size=Vector2(1000,560)
 image.expand_mode=TextureRect.EXPAND_IGNORE_SIZE
 image.stretch_mode=TextureRect.STRETCH_KEEP_ASPECT_CENTERED
 add_child(image)
